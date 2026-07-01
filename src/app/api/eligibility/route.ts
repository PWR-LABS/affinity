import { NextResponse } from "next/server";

import { checkEligibility } from "@/lib/decision/eligibility";

export const dynamic = "force-dynamic";

/**
 * Live eligibility check. The Marketplace API key stays server-side — the client never sees it.
 * Privacy: we do NOT log the request body (it carries income); only a coarse outcome line.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const zip = String(b.zip ?? "").trim();
  const income = Number(b.income);
  const householdSize = Number(b.householdSize ?? 1);
  const age = Number(b.age);
  const year = Number(b.year ?? 2026);

  if (!/^\d{5}$/.test(zip)) return NextResponse.json({ error: "Enter a valid 5-digit ZIP code." }, { status: 400 });
  if (!Number.isFinite(income) || income < 0) return NextResponse.json({ error: "Enter your annual income." }, { status: 400 });
  if (!Number.isFinite(age) || age < 0 || age > 120) return NextResponse.json({ error: "Enter a valid age." }, { status: 400 });
  if (!Number.isFinite(householdSize) || householdSize < 1 || householdSize > 12)
    return NextResponse.json({ error: "Household size must be 1–12." }, { status: 400 });

  try {
    const result = await checkEligibility({ zip, income, householdSize, age, year });
    return NextResponse.json(result);
  } catch (err) {
    // No PII in logs — just the failure class.
    console.error("eligibility check failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "We couldn't reach the Marketplace right now. Try again in a moment." },
      { status: 502 },
    );
  }
}
