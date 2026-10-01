import { NextResponse } from "next/server";

import { checkEligibility, multiPersonHouseholdHandoff, officialStateHandoff } from "@/lib/decision/eligibility";
import { MarketplaceApiError } from "@/lib/marketplace/client";
import { medicaidResourceByCode } from "@/lib/medicaid/states";

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

  const state = String(b.state ?? "").trim().toUpperCase();
  const zip = String(b.zip ?? "").trim();
  const income = Number(b.income);
  const householdSize = Number(b.householdSize ?? 1);
  const age = Number(b.age);
  const year = Number(b.year ?? 2026);
  const missing = (value: unknown) => value == null || (typeof value === "string" && value.trim() === "");

  if (!medicaidResourceByCode(state)) return NextResponse.json({ error: "Select your state." }, { status: 400 });
  if (!/^\d{5}$/.test(zip)) return NextResponse.json({ error: "Enter a valid 5-digit ZIP code." }, { status: 400 });
  if (missing(b.income) || !Number.isFinite(income) || income < 0) return NextResponse.json({ error: "Enter your annual income." }, { status: 400 });
  if (missing(b.age) || !Number.isInteger(age) || age < 0 || age > 120) return NextResponse.json({ error: "Enter a valid age." }, { status: 400 });
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 12)
    return NextResponse.json({ error: "Household size must be 1–12." }, { status: 400 });
  if (householdSize > 1) return NextResponse.json(multiPersonHouseholdHandoff(state, zip));

  try {
    const result = await checkEligibility({ state, zip, income, householdSize, age, year });
    return NextResponse.json(result);
  } catch (err) {
    // MarketplaceApiError messages can contain a ZIP in the request path. Log only a fixed
    // failure category and upstream status, never the request-specific message or body.
    console.error("eligibility check failed:", err instanceof MarketplaceApiError ? `marketplace_${err.status}` : "unexpected");
    return NextResponse.json(officialStateHandoff(state, zip));
  }
}
