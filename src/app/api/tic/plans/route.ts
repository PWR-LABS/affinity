import { NextResponse } from "next/server";

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
    const links = await prisma.ticPlanLink.findMany({
      where: { planName: { contains: q, mode: "insensitive" } },
      distinct: ["planIdType", "planId", "planName"],
      take: 12,
      select: {
        planName: true,
        planIdType: true,
        planId: true,
        planMarketType: true,
        file: { select: { reportingEntity: true } },
      },
      orderBy: { planName: "asc" },
    });
    return NextResponse.json({
      items: links.map((l) => ({
        planIdType: l.planIdType,
        planId: l.planId,
        planName: l.planName,
        marketType: l.planMarketType,
        issuer: l.file.reportingEntity,
      })),
    });
  } catch {
    return NextResponse.json(
      { items: [], error: "The commercial plan index isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
