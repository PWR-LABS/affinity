/**
 * Live plan board — for people who are Marketplace-bound: their real plans, ranked by what matters,
 * with which of THEIR doctors and meds each plan actually covers. Generic (no health-system config
 * needed): the headline is "which plans keep ALL your doctors in-network," answered per doctor from the
 * live API. Coverage is API-sourced (one source); confirm with the office before enrolling.
 *
 * Per the API ToS we query live per request and never pull the whole dataset. Server-side only.
 */
import { MarketplaceClient } from "@/lib/marketplace/client";
import { stateBasedMarketplace, StateNotSupportedError } from "@/lib/marketplace/states";
import type { MarketplaceCostShare, MarketplaceDrugCoverage, MarketplacePlan } from "@/lib/marketplace/types";

export interface LivePlansInput {
  zip: string;
  income: number;
  householdSize: number;
  age: number;
  year: number;
  doctors: Array<{ npi: string; label?: string }>;
  drugs: Array<{ rxcui: string; label?: string }>;
}

export interface LiveSubjectStatus {
  key: string;
  label?: string;
  /** true = in-network/on-formulary, false = not covered, null = the API didn't answer (unknown). */
  covered: boolean | null;
  /** Drugs only: the plan requires prior authorization for this drug (absent = no flag / unknown). */
  priorAuth?: boolean;
}

export interface LivePlanRow {
  id: string;
  name: string;
  metal?: string;
  type?: string;
  premiumMonthly: number;
  netPremiumMonthly: number;
  deductible?: number;
  oopMax?: number;
  /** The plan's official issuer documents from the Marketplace API. */
  docs?: { sbc?: string; brochure?: string; formulary?: string; network?: string };
  doctorsCovered: number;
  doctorsTotal: number;
  drugsCovered: number;
  drugsTotal: number;
  keepsAllDoctors: boolean;
  doctors: LiveSubjectStatus[];
  drugs: LiveSubjectStatus[];
}

export interface LivePlansResult {
  county?: string;
  state?: string;
  medicaidEligible: boolean;
  aptcMonthly: number;
  totalPlans: number;
  plansKeepingAllDoctors: number;
  doctorsTotal: number;
  drugsTotal: number;
  plans: LivePlanRow[];
  notes: string[];
}

/** Thrown when a ZIP doesn't resolve to a county — a bad-input case (400), not a Marketplace outage (502). */
export class ZipNotFoundError extends Error {
  constructor(zip: string) {
    super(`No county found for ZIP ${zip}`);
    this.name = "ZipNotFoundError";
  }
}

const isCovered = (s?: string): boolean | null => {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v.includes("notcovered")) return false;
  if (v.includes("covered")) return true;
  return null;
};

/**
 * Pick the per-person in-network combined deductible/OOP-max amount from the API's variant list.
 * The API already returns the household's income-appropriate CSR variant, so we just choose the right
 * scope: prefer Individual (per-person) over Family so a single filer never sees the larger family number,
 * and the combined medical+drug entry over a medical-only one.
 */
function pickCostShare(items?: MarketplaceCostShare[]): number | undefined {
  if (!items?.length) return undefined;
  const inNet = items.filter((d) => (d.network_tier ?? "In-Network") === "In-Network");
  const individual = inNet.filter((d) => (d.family_cost ?? "Individual") === "Individual");
  const pool = individual.length ? individual : inNet;
  const combined = pool.find((d) => /combined|medical and drug/i.test(d.type ?? ""));
  const pick = combined ?? pool.find((d) => typeof d.amount === "number") ?? items[0];
  return typeof pick?.amount === "number" ? pick.amount : undefined;
}

export async function runLivePlans(input: LivePlansInput): Promise<LivePlansResult> {
  const client = new MarketplaceClient();
  if (!client.isLive) throw new Error("Marketplace API key not configured.");

  const counties = await client.countiesByZip(input.zip);
  const county = counties[0];
  if (!county) throw new ZipNotFoundError(input.zip);
  // State-Based Marketplaces aren't served by the federal API — redirect, don't fail opaquely.
  const sbm = stateBasedMarketplace(county.state);
  if (sbm) throw new StateNotSupportedError(sbm);
  const place = { zipcode: input.zip, countyfips: county.fips, state: county.state };
  const people = Array.from({ length: Math.max(1, input.householdSize) }, () => ({ age: input.age }));
  const household = { income: input.income, people };

  const est = (await client.estimateEligibility({ household, place, year: input.year })).estimates?.[0] ?? {};
  const medicaidEligible = Boolean((est as { is_medicaid_chip?: boolean }).is_medicaid_chip);
  const aptcMonthly = Math.round((est.aptc ?? 0) as number);

  // Paginate all plans (live page size is 10).
  const plans: MarketplacePlan[] = [];
  let total = Infinity;
  for (let offset = 0; plans.length < total && offset < 400; offset += 10) {
    const res = await client.searchPlans({ household, market: "Individual", place, year: input.year, limit: 10, offset });
    if (res.plans.length === 0) break;
    plans.push(...res.plans);
    total = res.total ?? plans.length;
  }
  const planIds = plans.map((p) => p.id);

  const npis = input.doctors.map((d) => d.npi);
  const rxcuis = input.drugs.map((d) => d.rxcui);
  const [provCov, drugCov] = await Promise.all([
    client.providersCovered(npis, planIds, input.year),
    client.drugsCovered(rxcuis, planIds, input.year),
  ]);
  const provByPlan = new Map<string, Map<string, string | undefined>>();
  for (const r of provCov) {
    if (!r.plan_id) continue;
    (provByPlan.get(r.plan_id) ?? provByPlan.set(r.plan_id, new Map()).get(r.plan_id)!).set(r.npi, r.coverage);
  }
  const drugByPlan = new Map<string, Map<string, MarketplaceDrugCoverage>>();
  for (const r of drugCov) {
    if (!r.plan_id) continue;
    (drugByPlan.get(r.plan_id) ?? drugByPlan.set(r.plan_id, new Map()).get(r.plan_id)!).set(r.rxcui, r);
  }

  const rows: LivePlanRow[] = plans.map((p) => {
    const pm = provByPlan.get(p.id) ?? new Map();
    const dm = drugByPlan.get(p.id) ?? new Map();
    const doctors: LiveSubjectStatus[] = input.doctors.map((d) => ({ key: d.npi, label: d.label, covered: isCovered(pm.get(d.npi)) }));
    const drugs: LiveSubjectStatus[] = input.drugs.map((d) => {
      const rec = dm.get(d.rxcui);
      return {
        key: d.rxcui,
        label: d.label,
        covered: isCovered(rec?.coverage),
        // Surface the plan's own PA flag only when it's affirmatively true — absent stays absent.
        ...(rec?.prior_authorization === true ? { priorAuth: true } : {}),
      };
    });
    const doctorsCovered = doctors.filter((x) => x.covered === true).length;
    const drugsCovered = drugs.filter((x) => x.covered === true).length;
    const gross = p.premium ?? 0;
    // APTC is a flat dollar credit applied to any plan's premium (capped at the premium). Compute net
    // from the eligibility APTC — plan-search `premium_w_credit` isn't reliably credited per-request.
    // Catastrophic plans can't receive APTC, so their net premium is the full sticker price.
    const aptcEligible = !/catastrophic/i.test(p.metal_level ?? "");
    const net = aptcEligible ? Math.max(0, gross - aptcMonthly) : gross;
    return {
      id: p.id,
      name: p.name,
      metal: p.metal_level,
      type: p.type,
      premiumMonthly: Math.round(gross),
      netPremiumMonthly: Math.round(net),
      deductible: pickCostShare(p.deductibles),
      oopMax: pickCostShare(p.moops),
      docs: { sbc: p.benefits_url, brochure: p.brochure_url, formulary: p.formulary_url, network: p.network_url },
      doctorsCovered,
      doctorsTotal: doctors.length,
      drugsCovered,
      drugsTotal: drugs.length,
      keepsAllDoctors: doctors.length > 0 && doctorsCovered === doctors.length,
      doctors,
      drugs,
    };
  });

  // Rank: plans that keep every doctor first, then more meds covered, then cheapest net premium.
  rows.sort((a, b) => {
    if (a.keepsAllDoctors !== b.keepsAllDoctors) return a.keepsAllDoctors ? -1 : 1;
    if (a.drugsCovered !== b.drugsCovered) return b.drugsCovered - a.drugsCovered;
    return a.netPremiumMonthly - b.netPremiumMonthly;
  });

  return {
    county: county.name,
    state: county.state,
    medicaidEligible,
    aptcMonthly,
    totalPlans: plans.length,
    plansKeepingAllDoctors: rows.filter((r) => r.keepsAllDoctors).length,
    doctorsTotal: input.doctors.length,
    drugsTotal: input.drugs.length,
    plans: rows, // all ranked plans; the client reveals them progressively
    notes: [
      "Coverage is from the Marketplace API (one source) — confirm with the provider's office before enrolling.",
      medicaidEligible ? "Note: at this income you may qualify for free Medicaid — a Marketplace plan would cost full price." : "",
    ].filter(Boolean),
  };
}
