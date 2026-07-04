import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { normalizeEmployerName } from "@/lib/tic/ingest";

export const dynamic = "force-dynamic";

/**
 * Employer-name typeahead — identity lookup only. Maps a typed employer name to likely EIN rows
 * from public DOL Form 5500 filings so the existing commercial verify flow can use the same EIN
 * input path. No coverage claims are made here, and no user data is stored or logged.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ items: [] });
  const normalized = normalizeEmployerName(q);
  if (normalized.length < 2) return NextResponse.json({ items: [] });

  try {
    const rows = await prisma.employerEin.findMany({
      where: { nameNorm: { contains: normalized, mode: "insensitive" } },
      take: 10,
      select: {
        ein: true,
        name: true,
        state: true,
        planName: true,
        participants: true,
      },
      orderBy: [{ participants: { sort: "desc", nulls: "last" } }, { name: "asc" }],
    });
    return NextResponse.json({
      items: rows.map((row) => ({
        ein: row.ein,
        name: row.name,
        state: row.state,
        planName: row.planName,
        participants: row.participants,
      })),
    });
  } catch {
    return NextResponse.json(
      { items: [], error: "The employer EIN lookup isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
