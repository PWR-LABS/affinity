import { NextResponse } from "next/server";

import { needsConfirmation, renderCoverageAnswer } from "@/lib/provenance";
import { queryTicAnswer } from "@/lib/tic/adapter";

export const dynamic = "force-dynamic";

/**
 * Commercial verify — "is this NPI in-network on this plan?" answered from the TiC index and returned
 * ONLY in doctrine shape: tri-state value + source + freshness + confidence + confirm guidance. POST
 * (not GET) so the doctor/plan pair never lands in URLs or request logs. Nothing is stored.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const npi = String(b.npi ?? "").trim();
  const planIdType = String(b.planIdType ?? "").trim().toLowerCase();
  const planId = String(b.planId ?? "").trim();
  const label = b.label ? String(b.label).slice(0, 120) : undefined;

  if (!/^\d{10}$/.test(npi)) return NextResponse.json({ error: "Enter a valid 10-digit NPI." }, { status: 400 });
  if (!planId || !["ein", "hios"].includes(planIdType))
    return NextResponse.json({ error: "Pick a plan from the search, or enter a 9-digit employer EIN." }, { status: 400 });

  try {
    const answer = await queryTicAnswer({ npi, planIdType, planId, subjectLabel: label });
    return NextResponse.json({
      npi,
      plan: { idType: planIdType, id: planId },
      value: answer.value,
      confidence: answer.confidence,
      source: answer.provenance.source,
      sourceUpdated: answer.provenance.sourceLastUpdated ?? null,
      rendered: renderCoverageAnswer(answer),
      needsConfirmation: needsConfirmation(answer),
    });
  } catch {
    return NextResponse.json(
      { error: "The commercial network index isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
