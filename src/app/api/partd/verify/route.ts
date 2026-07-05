import { NextResponse } from "next/server";

import { needsConfirmation, renderCoverageAnswer } from "@/lib/provenance";
import { queryPartDAnswer } from "@/lib/partd/adapter";

export const dynamic = "force-dynamic";

/**
 * Medicare Part D verify — "is this drug (RxCUI) on this Part D plan's formulary, at what tier, and does
 * it carry prior-auth / step-therapy / quantity-limit?" Answered from the CMS Part D index and returned
 * ONLY in doctrine shape (tri-state value + source + freshness + confidence + confirm guidance), PLUS the
 * utilization-management flags — the fields HealthCare.gov's own consumer API withholds. POST (not GET) so
 * the drug/plan pair never lands in URLs or request logs. Nothing is stored.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const rxcui = String(b.rxcui ?? "").trim();
  const contractId = String(b.contractId ?? "").trim().toUpperCase();
  const planId = String(b.planId ?? "").trim();
  const segmentId = String(b.segmentId ?? "0").trim();
  const contractYear = Number(b.contractYear ?? 2026);
  const label = b.label ? String(b.label).slice(0, 120) : undefined;

  if (!/^\d{1,8}$/.test(rxcui)) return NextResponse.json({ error: "Enter a valid RxCUI." }, { status: 400 });
  if (!/^[A-Z]\d{4}$/.test(contractId))
    return NextResponse.json({ error: "Enter a valid Part D contract ID (e.g. S5810)." }, { status: 400 });
  if (!/^\d{1,3}$/.test(planId)) return NextResponse.json({ error: "Enter a valid plan ID (e.g. 001)." }, { status: 400 });
  if (!/^\d{1,3}$/.test(segmentId)) return NextResponse.json({ error: "Enter a valid segment ID." }, { status: 400 });
  if (!Number.isInteger(contractYear) || contractYear < 2020 || contractYear > 2030)
    return NextResponse.json({ error: "Enter a valid contract year." }, { status: 400 });

  try {
    const { answer, um } = await queryPartDAnswer({ rxcui, contractId, planId, segmentId, contractYear, subjectLabel: label });
    return NextResponse.json({
      rxcui,
      plan: { contractId, planId, segmentId, contractYear },
      value: answer.value,
      confidence: answer.confidence,
      formularyTier: answer.formularyTier ?? null,
      source: answer.provenance.source,
      sourceUpdated: answer.provenance.sourceLastUpdated ?? null,
      // The utilization-management flags the Marketplace API hides. Present only when on formulary.
      utilizationManagement: um,
      rendered: renderCoverageAnswer(answer),
      needsConfirmation: needsConfirmation(answer),
    });
  } catch {
    return NextResponse.json(
      { error: "The Medicare Part D index isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
