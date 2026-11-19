import { ticSourceWindow } from "@/lib/tic/freshness";
import { prisma } from "@/lib/prisma";

export interface CoverageReadiness {
  employer: boolean;
  partD: boolean;
}

const READINESS_TTL_MS = 60_000;
let readinessCache: { value: CoverageReadiness; expiresAt: number } | null = null;
let readinessInFlight: Promise<CoverageReadiness> | null = null;

/** Availability of recent listings, NOT certification of plan completeness. */
export async function employerIndexReady(db = prisma, now = new Date()): Promise<boolean> {
  const window = ticSourceWindow(now);
  const rows = await db.$queryRaw<Array<{ ok: number }>>`
    SELECT 1 AS ok
    FROM "TicFile" f
    WHERE f."active" = true
      AND f."sourceLastUpdated" >= ${window.gte}
      AND f."sourceLastUpdated" <= ${window.lte}
      AND (
        EXISTS (
          SELECT 1
          FROM "TicNpiIndex" idx
          WHERE idx."fileId" = f."id"
            AND idx."format" = 'npi-prefix-v1'
            AND idx."npiCount" > 0
        )
        OR EXISTS (
          SELECT 1
          FROM "TicMembership" m
          WHERE m."fileId" = f."id"
        )
      )
      AND (
        EXISTS (
          SELECT 1
          FROM "TicPlanLink" l
          WHERE l."fileId" = f."id"
        )
        OR EXISTS (
          SELECT 1
          FROM "TicFilePlanSet" fps
          WHERE fps."fileId" = f."id"
        )
      )
    LIMIT 1`;
  return rows.length > 0;
}

async function partDIndexReady(): Promise<boolean> {
  const [drug, plan] = await Promise.all([
    prisma.partDFormularyDrug.findFirst({ select: { id: true } }),
    prisma.partDPlan.findFirst({ select: { id: true } }),
  ]);
  return Boolean(drug && plan);
}

/**
 * A verifier is available only when both sides of its lookup join hold data.
 * Missing configuration, migrations, or source data all fail closed.
 * Results are briefly cached so header link prefetches do not re-query Postgres on every navigation.
 */
export async function getCoverageReadiness(nowMs = Date.now()): Promise<CoverageReadiness> {
  if (!process.env.DATABASE_URL) return { employer: false, partD: false };
  if (readinessCache && nowMs < readinessCache.expiresAt) return readinessCache.value;
  if (readinessInFlight) return readinessInFlight;

  const pending = (async () => {
    let errored = false;
    const [employer, partD] = await Promise.all([
      employerIndexReady(prisma, new Date(nowMs)).catch(() => {
        errored = true;
        return false;
      }),
      partDIndexReady().catch(() => {
        errored = true;
        return false;
      }),
    ]);
    const value = { employer, partD };
    if (!errored) {
      readinessCache = { value, expiresAt: nowMs + READINESS_TTL_MS };
    }
    return value;
  })();

  readinessInFlight = pending;
  try {
    return await pending;
  } finally {
    if (readinessInFlight === pending) readinessInFlight = null;
  }
}

export function resetCoverageReadinessCache(): void {
  readinessCache = null;
  readinessInFlight = null;
}
