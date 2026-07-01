/**
 * Live eligibility check — the highest-value, simplest answer the tool gives: are you likely eligible
 * for free Medicaid, or for a subsidized Marketplace plan, at your income? Needs only ZIP + income +
 * household (no doctors/meds), so it works for anyone. Server-side only (uses the Marketplace API key).
 *
 * Decision support, not a determination: the verdict mirrors HealthCare.gov's own eligibility estimate;
 * the final call belongs to the state Medicaid agency and the official Marketplace.
 */
import { MarketplaceClient } from "@/lib/marketplace/client";
import { stateBasedMarketplace } from "@/lib/marketplace/states";

export interface EligibilityInput {
  zip: string;
  /** Annual household income (MAGI), whole dollars. */
  income: number;
  householdSize: number;
  /** Primary applicant age (drives premium rating; Medicaid eligibility is income-driven). */
  age: number;
  year: number;
}

export type EligibilityVerdict = "medicaid" | "marketplace" | "coverage_gap" | "state_marketplace" | "unknown";

export interface EligibilityResult {
  zip: string;
  county?: string;
  state?: string;
  verdict: EligibilityVerdict;
  medicaidEligible: boolean;
  /** Advance premium tax credit, $/month (0 when Medicaid-eligible or above the cliff). */
  aptcMonthly: number;
  inCoverageGap: boolean;
  /** Number of Marketplace plans available in the rating area (context). */
  planCount?: number;
  /** Cheapest sticker monthly premium among available plans (pre-subsidy), for context. */
  cheapestPremiumMonthly?: number;
  /** Honest one-line headline. Never a determination. */
  headline: string;
  /** What to do next, plain language. */
  nextSteps: string[];
  notes: string[];
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export async function checkEligibility(input: EligibilityInput): Promise<EligibilityResult> {
  const client = new MarketplaceClient();
  if (!client.isLive) throw new Error("Marketplace API key not configured.");

  const counties = await client.countiesByZip(input.zip);
  const county = counties[0];
  if (!county) {
    return {
      zip: input.zip,
      verdict: "unknown",
      medicaidEligible: false,
      aptcMonthly: 0,
      inCoverageGap: false,
      headline: `We couldn't find a county for ZIP ${input.zip}. Double-check the ZIP.`,
      nextSteps: ["Re-enter your 5-digit ZIP code."],
      notes: [],
    };
  }
  // State-Based Marketplaces aren't on the federal API — answer honestly and send them to their own
  // exchange instead of letting the eligibility call 400 into a misleading "try again" error.
  const sbm = stateBasedMarketplace(county.state);
  if (sbm) {
    return {
      zip: input.zip,
      county: county.name,
      state: county.state,
      verdict: "state_marketplace",
      medicaidEligible: false,
      aptcMonthly: 0,
      inCoverageGap: false,
      headline: `${sbm.state} runs its own health marketplace, so we can't pull live plans here — but you likely still qualify for help.`,
      nextSteps: [
        `Check your plans and subsidies at ${sbm.name} — ${sbm.url}.`,
        "For Medicaid or free in-person help, see localhelp.healthcare.gov.",
      ],
      notes: [
        `This tool reads the federal HealthCare.gov data, which covers about 30 states. ${sbm.state} isn't one of them — its own marketplace has your exact plans and subsidy amount.`,
      ],
    };
  }

  const place = { zipcode: input.zip, countyfips: county.fips, state: county.state };
  // Approximate the household with the given size at the applicant's age — income vs. FPL drives the verdict.
  const people = Array.from({ length: Math.max(1, input.householdSize) }, () => ({ age: input.age }));
  const household = { income: input.income, people };

  const est = (await client.estimateEligibility({ household, place, year: input.year })).estimates?.[0] ?? {};
  const medicaidEligible = Boolean((est as { is_medicaid_chip?: boolean }).is_medicaid_chip);
  const aptcMonthly = Math.round((est.aptc ?? 0) as number);
  const inCoverageGap = Boolean((est as { in_coverage_gap?: boolean }).in_coverage_gap);

  // Light plan context (one page) — count + cheapest premium. Never the whole dataset (ToS: no bulk).
  let planCount: number | undefined;
  let cheapestPremiumMonthly: number | undefined;
  try {
    const search = await client.searchPlans({ household, market: "Individual", place, year: input.year, limit: 10, offset: 0 });
    planCount = search.total;
    const prems = search.plans.map((p) => p.premium ?? Infinity).filter((n) => Number.isFinite(n));
    if (prems.length) cheapestPremiumMonthly = Math.min(...prems);
  } catch {
    /* context only — non-fatal */
  }

  const verdict: EligibilityVerdict = inCoverageGap
    ? "coverage_gap"
    : medicaidEligible
      ? "medicaid"
      : aptcMonthly > 0 || (planCount ?? 0) > 0
        ? "marketplace"
        : "unknown";

  const loc = `${county.name}, ${county.state}`;
  // Navigator help is national by default — localhelp.healthcare.gov finds free, unbiased in-person help
  // in every state. Ohio (the tool's home base) gets its specific Medicaid + Navigator links.
  const isOhio = county.state === "OH";
  const navigator = isOhio ? "getcoveredohio.org" : "localhelp.healthcare.gov";
  let headline: string;
  const nextSteps: string[] = [];
  const notes = ["This mirrors HealthCare.gov's own estimate at the income you entered — it's decision support, not a final determination."];

  if (verdict === "medicaid") {
    headline = `At this income you likely qualify for Medicaid — free coverage — in ${loc}.`;
    nextSteps.push(
      isOhio
        ? "Apply or confirm Medicaid in Ohio at ssp.benefits.ohio.gov, or get free help from a Navigator — getcoveredohio.org / (833) 628-4467."
        : "Apply or confirm Medicaid with your state's Medicaid agency, or get free in-person help from a Navigator — localhelp.healthcare.gov.",
      "A subsidized Marketplace plan gives $0 here, so don't buy one unless your income rises above the Medicaid line.",
    );
  } else if (verdict === "marketplace") {
    headline = aptcMonthly > 0
      ? `You likely qualify for a subsidy of about ${usd(aptcMonthly)}/month toward a Marketplace plan in ${loc}.`
      : `You're likely in the Marketplace range (no Medicaid) in ${loc}.`;
    nextSteps.push(
      "Compare plans by their TRUE annual cost — premium after subsidy, plus deductible, copays, and drug costs — not the sticker premium.",
      "Check that your doctors and medications are covered before you enroll.",
    );
    if (cheapestPremiumMonthly !== undefined) notes.push(`Cheapest sticker premium here is ${usd(cheapestPremiumMonthly)}/mo before subsidy.`);
  } else if (verdict === "coverage_gap") {
    headline = `Your income may fall in a coverage gap in ${loc} — a Navigator can help.`;
    nextSteps.push(`Talk to a free Navigator (${navigator}) — gaps often have a fix once your real income is reviewed.`);
  } else {
    headline = `We couldn't determine eligibility from these inputs in ${loc}.`;
    nextSteps.push(`Double-check your income and household size, or talk to a free Navigator (${navigator}).`);
  }

  return {
    zip: input.zip,
    county: county.name,
    state: county.state,
    verdict,
    medicaidEligible,
    aptcMonthly,
    inCoverageGap,
    planCount,
    cheapestPremiumMonthly,
    headline,
    nextSteps,
    notes,
  };
}
