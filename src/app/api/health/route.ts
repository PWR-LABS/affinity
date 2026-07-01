import { NextResponse } from "next/server";

import { MarketplaceClient } from "@/lib/marketplace/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Liveness + dependency health.
 *
 * - **Default** (`/api/health`): fast. DB ping + whether the Marketplace key is *set* (no external call —
 *   safe for frequent liveness pings). Degrades gracefully: an unset DATABASE_URL is "skipped", not
 *   "error", so the M0 spine + smoke gate pass without Postgres.
 * - **Deep** (`/api/health?deep=1`): additionally makes ONE cheap real Marketplace call (a county lookup,
 *   cache-bypassed) to prove the key actually *works*. An expired/invalid CMS key then surfaces as
 *   `degraded` (503) instead of a silently-broken site. Point an uptime monitor here (every few minutes,
 *   not every second — it spends one API call per hit). The key itself is never returned.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const checks: Record<string, string> = { app: "ok" };

  if (process.env.DATABASE_URL) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }
  } else {
    checks.database = "skipped";
  }

  // Cheap presence check (always): is the key wired at all?
  checks.marketplaceApiKey = process.env.MARKETPLACE_API_KEY ? "present" : "absent";

  // Deep check: prove the key authenticates with one real, cache-bypassed call. Never leaks the key.
  if (deep) {
    const client = new MarketplaceClient({ useCache: false });
    if (!client.isLive) {
      checks.marketplaceApi = "absent";
    } else {
      try {
        await client.countiesByZip("78701"); // any valid ZIP; a 2xx proves the key authenticates
        checks.marketplaceApi = "ok";
      } catch (err) {
        // Expired/invalid key (401/403) or a Marketplace outage — either way, degraded. Status only, no key.
        const status = (err as { status?: number }).status;
        checks.marketplaceApi = status ? `error:${status}` : "error";
      }
    }
  }

  const ok = Object.values(checks).every((v) => v === "ok" || v === "skipped" || v === "present" || v === "absent");
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      service: "affinity",
      checks,
      nodeEnv: process.env.NODE_ENV ?? "unknown",
    },
    { status: ok ? 200 : 503 },
  );
}
