import { NextResponse } from "next/server";

import { pdpRegionCodeForState } from "@/lib/partd/shortlist";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  const state = params.get("state")?.trim().toUpperCase() ?? "";
  const contractYear = Number(params.get("year") ?? "2026");

  if (q.length < 2) return NextResponse.json({ items: [] });
  if (state && !/^[A-Z]{2}$/.test(state)) return NextResponse.json({ items: [], error: "Enter a valid state." }, { status: 400 });
  if (!Number.isInteger(contractYear) || contractYear < 2020 || contractYear > 2030) {
    return NextResponse.json({ items: [], error: "Enter a valid contract year." }, { status: 400 });
  }

  try {
    const pdpRegionCode = state ? pdpRegionCodeForState(state) : null;
    const plans = await prisma.partDPlan.findMany({
      where: {
        contractYear,
        ...(state
          ? {
              OR: [
                { state },
                ...(pdpRegionCode ? [{ pdpRegionCode }] : []),
                { state: null, pdpRegionCode: null },
              ],
            }
          : {}),
        AND: [
          {
            OR: [
              { planName: { contains: q, mode: "insensitive" } },
              { contractId: { startsWith: q.toUpperCase(), mode: "insensitive" } },
              { planId: { startsWith: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: [{ planName: "asc" }, { contractId: "asc" }, { planId: "asc" }, { segmentId: "asc" }],
      take: 12,
      select: {
        contractId: true,
        planId: true,
        segmentId: true,
        contractYear: true,
        planName: true,
        state: true,
      },
    });
    return NextResponse.json({ items: plans });
  } catch {
    return NextResponse.json(
      { items: [], error: "The Medicare Part D index isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
