import { NextResponse } from "next/server";

import { runLivePlans, ZipNotFoundError } from "@/lib/decision/live";
import { StateNotSupportedError } from "@/lib/marketplace/states";

export const dynamic = "force-dynamic";

/** Live plan board. Key stays server-side; request body (income, doctors, meds) is never logged. */
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
  const age = Number(b.age);
  const householdSize = Number(b.householdSize ?? 1);
  const year = Number(b.year ?? 2026);

  if (!/^\d{5}$/.test(zip)) return NextResponse.json({ error: "Enter a valid 5-digit ZIP code." }, { status: 400 });
  if (!Number.isFinite(income) || income < 0) return NextResponse.json({ error: "Enter your annual income." }, { status: 400 });
  if (!Number.isFinite(age) || age < 0 || age > 120) return NextResponse.json({ error: "Enter a valid age." }, { status: 400 });
  if (!Number.isFinite(householdSize) || householdSize < 1 || householdSize > 12)
    return NextResponse.json({ error: "Household size must be 1–12." }, { status: 400 });

  const doctors = Array.isArray(b.doctors)
    ? (b.doctors as Array<Record<string, unknown>>)
        .map((d) => ({ npi: String(d.npi ?? "").trim(), label: d.label ? String(d.label) : undefined }))
        .filter((d) => /^\d{10}$/.test(d.npi))
        .slice(0, 12)
    : [];
  const drugs = Array.isArray(b.drugs)
    ? (b.drugs as Array<Record<string, unknown>>)
        .map((d) => ({ rxcui: String(d.rxcui ?? "").trim(), label: d.label ? String(d.label) : undefined }))
        .filter((d) => d.rxcui.length > 0)
        .slice(0, 20)
    : [];

  try {
    const result = await runLivePlans({ zip, income, householdSize, age, year, doctors, drugs });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZipNotFoundError) {
      return NextResponse.json({ error: "We couldn't find a county for that ZIP. Double-check your ZIP code." }, { status: 400 });
    }
    if (err instanceof StateNotSupportedError) {
      const m = err.marketplace;
      return NextResponse.json(
        { error: `${m.state} runs its own marketplace, so we can't show live plans here. Find your plans and subsidies at ${m.name} — ${m.url}.` },
        { status: 400 },
      );
    }
    console.error("plan board failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "We couldn't reach the Marketplace right now. Try again in a moment." }, { status: 502 });
  }
}
