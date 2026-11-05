import { NextResponse } from "next/server";

import { searchTicPlans } from "@/lib/tic/shared-plans";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Commercial plan typeahead — search the TiC index's plan links by name. Returns distinct
 * (planIdType, planId, planName) with the reporting issuer, so a user can identify "their" employer
 * plan without knowing its EIN. Degrades honestly (503) when the index isn't loaded in this
 * environment. No user data is stored or logged.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ items: [] });
  try {
    return NextResponse.json({items: await searchTicPlans(prisma,q)});
  } catch {
    return NextResponse.json(
      { items: [], error: "The commercial plan index isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
