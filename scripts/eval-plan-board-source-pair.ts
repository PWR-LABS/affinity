/**
 * Bounded direct-CMS versus deployed plan-board comparison for two synthetic
 * one-person 2026 profiles. Check only the first 10 source plans per profile;
 * do not mirror the source catalog or retain raw responses/keyed URLs.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const APP_URL = "https://affinity.pwr-labs.ai";
const CMS_API = "https://marketplace.api.healthcare.gov/api/v1";
const YEAR = 2026;
const PROFILES = [
  { id: "oh-subsidized", zip: "44106", state: "OH", income: 45_000, age: 50 },
  { id: "wi-no-subsidy", zip: "53703", state: "WI", income: 100_000, age: 60 },
] as const;

type Json = Record<string, unknown>;
type CostShare = { amount?: unknown; type?: unknown; csr?: unknown; network_tier?: unknown; family_cost?: unknown };

async function readJson(response: Response, label: string): Promise<Json> {
  if (!response.ok) throw new Error(`${label}_http_${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${label}_invalid_json`);
  return body as Json;
}

async function official(path: string, method: "GET" | "POST", body?: Json): Promise<Json> {
  const key = process.env.MARKETPLACE_API_KEY?.trim();
  if (!key) throw new Error("marketplace_key_unset");
  const url = new URL(`${CMS_API}${path}`);
  url.searchParams.set("apikey", key);
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return readJson(response, "cms");
}

function costShare(items: unknown): Json {
  if (!Array.isArray(items) || items.length === 0) return { amount: null, selected: null, candidateCount: 0 };
  const all = items.filter((item): item is CostShare => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  const eligible = all.filter((item) =>
    typeof item.network_tier === "string" && item.network_tier.trim().toLowerCase() === "in-network" &&
    typeof item.family_cost === "string" && item.family_cost.trim().toLowerCase() === "individual" &&
    typeof item.type === "string" && /combined|medical and drug/i.test(item.type) &&
    typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount >= 0,
  );
  const distinctAmounts = [...new Set(eligible.map((item) => item.amount))];
  const selected = distinctAmounts.length === 1 ? eligible[0] : undefined;
  return {
    amount: typeof selected?.amount === "number" ? selected.amount : null,
    selected: selected ? { type: selected.type ?? null, csr: selected.csr ?? null, networkTier: selected.network_tier ?? null, familyCost: selected.family_cost ?? null } : null,
    candidateCount: all.length,
    eligibleCount: eligible.length,
    distinctEligibleAmounts: distinctAmounts.length,
  };
}

function sourcePlan(plan: Json, aptc: number): Json {
  const raw = plan.premium;
  const validPremium = typeof raw === "number" && Number.isFinite(raw) && raw >= 0;
  const credit = /catastrophic/i.test(String(plan.metal_level ?? "")) ? 0 : aptc;
  const net = validPremium ? Math.round(Math.max(0, raw - credit)) : null;
  const deductible = costShare(plan.deductibles);
  const oopMax = costShare(plan.moops);
  return {
    id: plan.id,
    name: plan.name,
    metal: plan.metal_level ?? null,
    grossMonthly: validPremium ? Math.round(raw) : null,
    netMonthly: net,
    netAnnual: net === null ? null : net * 12,
    deductible: deductible.amount,
    oopMax: oopMax.amount,
    sourceCostShareSelection: { deductible: { selected: deductible.selected, candidateCount: deductible.candidateCount }, oopMax: { selected: oopMax.selected, candidateCount: oopMax.candidateCount } },
  };
}

function appPlan(row: Json): Json {
  return {
    id: row.id,
    name: row.name,
    metal: row.metal ?? null,
    grossMonthly: row.premiumMonthly ?? null,
    netMonthly: row.netPremiumMonthly ?? null,
    netAnnual: row.netPremiumAnnual ?? null,
    deductible: row.deductible ?? null,
    oopMax: row.oopMax ?? null,
  };
}

function differences(source: Json, observed: Json): string[] {
  return Object.keys(observed).filter((field) => source[field] !== observed[field]);
}

async function evaluate(profile: typeof PROFILES[number]): Promise<Json> {
  const app = await readJson(await fetch(`${APP_URL}/api/plans`, {
    method: "POST",
    signal: AbortSignal.timeout(90_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ zip: profile.zip, income: profile.income, age: profile.age, householdSize: 1, year: YEAR, doctors: [], drugs: [] }),
  }), "app");
  const geo = await official(`/counties/by/zip/${profile.zip}`, "GET");
  const county = Array.isArray(geo.counties) ? geo.counties[0] as Json | undefined : undefined;
  if (!county || county.state !== profile.state || typeof county.fips !== "string") throw new Error("cms_county_unresolved");
  const household = { income: profile.income, people: [{ age: profile.age }] };
  const place = { zipcode: profile.zip, countyfips: county.fips, state: county.state };
  const estimate = await official("/households/eligibility/estimates", "POST", { household, place, year: YEAR });
  const firstEstimate = Array.isArray(estimate.estimates) ? estimate.estimates[0] as Json | undefined : undefined;
  if (!firstEstimate || typeof firstEstimate.aptc !== "number") throw new Error("cms_aptc_missing");
  const aptc = Math.round(firstEstimate.aptc);
  const search = await official("/plans/search", "POST", { household, market: "Individual", place, year: YEAR, limit: 10, offset: 0 });
  const sourcePlans = Array.isArray(search.plans) ? search.plans as Json[] : [];
  const appPlans = Array.isArray(app.plans) ? app.plans as Json[] : [];
  const byId = new Map(appPlans.map((row) => [row.id, row]));
  const rows = sourcePlans.map((plan) => {
    const source = sourcePlan(plan, aptc);
    const found = byId.get(plan.id);
    const observed = found ? appPlan(found) : null;
    const fields = observed ? differences(source, observed) : ["planMissingFromApp"];
    return { id: plan.id, source, observed, differences: fields };
  });
  const profileDifferences = [
    ...(app.state === profile.state ? [] : ["state"]),
    ...(app.county === county.name ? [] : ["county"]),
    ...(app.aptcMonthly === aptc ? [] : ["aptcMonthly"]),
    ...(app.totalPlans === search.total ? [] : ["totalPlans"]),
    ...(sourcePlans.length === 10 ? [] : ["sourcePageLength"]),
  ];
  return {
    id: profile.id,
    input: { ...profile, householdSize: 1, year: YEAR },
    source: { county: county.name, state: county.state, aptcMonthly: aptc, totalPlans: search.total, firstPagePlans: sourcePlans.length },
    observed: { county: app.county, state: app.state, aptcMonthly: app.aptcMonthly, totalPlans: app.totalPlans },
    profileDifferences,
    rows,
    checkedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  assert.equal(PROFILES.length, 2);
  if (!process.env.MARKETPLACE_API_KEY?.trim()) throw new Error("marketplace_key_unset");
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("output_path_missing");
  const profiles: Json[] = [];
  for (const profile of PROFILES) {
    try {
      const result = await evaluate(profile);
      profiles.push(result);
      const rowDifferences = (result.rows as Json[]).filter((row) => (row.differences as string[]).length > 0).length;
      console.log(`${(result.profileDifferences as string[]).length || rowDifferences ? "DIFF" : "PASS"} ${profile.id}`);
    } catch (error) {
      const category = error instanceof Error && /^(cms|app)_http_\d{3}$|^cms_(county_unresolved|aptc_missing)$/.test(error.message)
        ? error.message : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "source_timeout" : "source_pair_unavailable";
      profiles.push({ id: profile.id, input: { ...profile, householdSize: 1, year: YEAR }, unavailable: category, checkedAt: new Date().toISOString() });
      console.log(`UNAVAILABLE ${profile.id} ${category}`);
    }
  }
  const evaluated = profiles.filter((profile) => !profile.unavailable);
  const comparedRows = evaluated.flatMap((profile) => profile.rows as Json[]);
  const mismatchedRows = comparedRows.filter((row) => (row.differences as string[]).length > 0);
  const mismatchedProfiles = evaluated.filter((profile) => (profile.profileDifferences as string[]).length > 0);
  const report = {
    evaluatedAt: new Date().toISOString(), app: APP_URL, planYear: YEAR,
    liveCommit: process.env.AFFINITY_LIVE_COMMIT ?? "unverified",
    source: "https://developer.cms.gov/marketplace-api/api-spec",
    scope: "Two synthetic one-person profiles; only first 10 source plans per profile checked against deployed board; no coverage, documents, or full annual cost validation",
    counts: { plannedProfiles: PROFILES.length, evaluatedProfiles: evaluated.length, unavailableProfiles: PROFILES.length - evaluated.length,
      comparedRows: comparedRows.length, mismatchedRows: mismatchedRows.length, mismatchedProfiles: mismatchedProfiles.length },
    profiles,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], json, { flag: "wx" });
  else console.log(json);
  if (evaluated.length !== PROFILES.length || mismatchedRows.length || mismatchedProfiles.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error && /^(marketplace_key_unset|output_path_missing)$/.test(error.message) ? error.message : "plan_board_pair_failed");
  process.exitCode = 1;
});
