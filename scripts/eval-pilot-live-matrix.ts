/**
 * Thirty prewritten synthetic 2026 requests against the deployed eligibility API.
 * Evidence bases stay separate: direct CMS response, CMS's 2026 exchange list,
 * or an app safety/validation contract. Never put a real person in this matrix.
 *
 * Run with MARKETPLACE_API_KEY in the environment. No keyed URL or raw CMS body
 * is retained or printed. --output writes only the reduced synthetic evidence.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

const APP_URL = "https://affinity.pwr-labs.ai";
const CMS_API = "https://marketplace.api.healthcare.gov/api/v1";
const YEAR = 2026;
const CMS_EXCHANGES = "https://www.cms.gov/CCIIO/Resources/Fact-Sheets-and-FAQs/state-marketplaces";

type Json = Record<string, unknown>;
type Input = { state: string; zip: string; income: number | string; age: number | string; householdSize: number; year: number };
type Basis = "direct_cms_full" | "direct_cms_geography" | "cms_2026_exchange_list" | "safety_contract" | "validation_contract";
type Case = { id: string; basis: Basis; input: Input; expectedName?: string; expectedStatus?: number; expectedError?: RegExp };

const single = (state: string, zip: string, income: number, age: number): Input =>
  ({ state, zip, income, age, householdSize: 1, year: YEAR });

const CASES: readonly Case[] = [
  { id: "oh-low", basis: "direct_cms_full", input: single("OH", "44106", 16_000, 30) },
  { id: "oh-mid", basis: "direct_cms_full", input: single("OH", "44106", 45_000, 50) },
  { id: "oh-high", basis: "direct_cms_full", input: single("OH", "44106", 100_000, 60) },
  { id: "fl-low", basis: "direct_cms_full", input: single("FL", "33101", 12_000, 35) },
  { id: "fl-mid", basis: "direct_cms_full", input: single("FL", "33101", 45_000, 45) },
  { id: "fl-high", basis: "direct_cms_full", input: single("FL", "33101", 100_000, 60) },
  { id: "tx-low", basis: "direct_cms_full", input: single("TX", "77002", 9_000, 35) },
  { id: "tx-mid", basis: "direct_cms_full", input: single("TX", "77002", 48_000, 45) },
  { id: "wi-high", basis: "direct_cms_full", input: single("WI", "53703", 100_000, 60) },
  { id: "ar-federal-platform", basis: "direct_cms_full", input: single("AR", "72201", 45_000, 40) },
  { id: "or-federal-platform", basis: "direct_cms_full", input: single("OR", "97204", 45_000, 40) },
  { id: "ok-federal-platform", basis: "direct_cms_full", input: single("OK", "73102", 45_000, 40) },
  { id: "oh-zip-in-fl", basis: "direct_cms_geography", input: single("OH", "33101", 45_000, 40) },
  { id: "fl-zip-in-oh", basis: "direct_cms_geography", input: single("FL", "44106", 45_000, 40) },
  { id: "ca-exchange", basis: "cms_2026_exchange_list", input: single("CA", "90012", 45_000, 40), expectedName: "Covered California" },
  { id: "co-exchange", basis: "cms_2026_exchange_list", input: single("CO", "80202", 45_000, 40), expectedName: "Connect for Health Colorado" },
  { id: "dc-exchange", basis: "cms_2026_exchange_list", input: single("DC", "20001", 45_000, 40), expectedName: "DC Health Link" },
  { id: "ga-exchange", basis: "cms_2026_exchange_list", input: single("GA", "30303", 45_000, 40), expectedName: "Georgia Access" },
  { id: "il-exchange", basis: "cms_2026_exchange_list", input: single("IL", "60601", 45_000, 40), expectedName: "Get Covered Illinois" },
  { id: "ny-exchange", basis: "cms_2026_exchange_list", input: single("NY", "10001", 45_000, 40), expectedName: "NY State of Health" },
  { id: "pa-exchange", basis: "cms_2026_exchange_list", input: single("PA", "19103", 45_000, 40), expectedName: "Pennie" },
  { id: "wa-exchange", basis: "cms_2026_exchange_list", input: single("WA", "98101", 45_000, 40), expectedName: "Washington Healthplanfinder" },
  { id: "oh-household", basis: "safety_contract", input: { ...single("OH", "44106", 45_000, 40), householdSize: 2 } },
  { id: "fl-household", basis: "safety_contract", input: { ...single("FL", "33101", 45_000, 40), householdSize: 3 } },
  { id: "il-household", basis: "safety_contract", input: { ...single("IL", "60601", 45_000, 40), householdSize: 4 } },
  { id: "ny-household", basis: "safety_contract", input: { ...single("NY", "10001", 45_000, 40), householdSize: 5 } },
  { id: "invalid-state", basis: "validation_contract", input: single("XX", "44106", 45_000, 40), expectedStatus: 400, expectedError: /select your state/i },
  { id: "invalid-zip", basis: "validation_contract", input: single("OH", "4410", 45_000, 40), expectedStatus: 400, expectedError: /5-digit ZIP/i },
  { id: "missing-age", basis: "validation_contract", input: { ...single("OH", "44106", 45_000, 40), age: "" }, expectedStatus: 400, expectedError: /valid age/i },
  { id: "unsupported-year", basis: "validation_contract", input: { ...single("OH", "44106", 45_000, 40), year: 2027 }, expectedStatus: 400, expectedError: /2026 only/i },
];
assert.equal(CASES.length, 30);
assert.equal(new Set(CASES.map((item) => item.id)).size, 30);

async function readJson(response: Response, label: string, allowErrorStatus = false): Promise<Json> {
  if (!response.ok && !allowErrorStatus) throw new Error(`${label}_http_${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}_invalid_json`);
  return value as Json;
}

async function official(path: string, method: "GET" | "POST", body?: Json): Promise<Json> {
  const key = process.env.MARKETPLACE_API_KEY?.trim();
  if (!key) throw new Error("marketplace_key_unset");
  const url = new URL(`${CMS_API}${path}`);
  url.searchParams.set("apikey", key);
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(25_000),
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return readJson(response, "cms");
}

function compare(expected: Json, observed: Json): string[] {
  return Object.entries(expected).filter(([field, value]) => value !== observed[field]).map(([field]) => field);
}

function observedFields(app: Json): Json {
  return {
    state: app.state,
    county: app.county ?? null,
    verdict: app.verdict,
    medicaidEligible: app.medicaidEligible,
    aptcMonthly: app.aptcMonthly,
    inCoverageGap: app.inCoverageGap,
    planCount: app.planCount ?? null,
    cheapestPremiumMonthly: app.cheapestPremiumMonthly ?? null,
  };
}

async function evaluate(item: Case): Promise<Json> {
  const response = await fetch(`${APP_URL}/api/eligibility`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item.input),
  });
  const app = await readJson(response, "app", item.basis === "validation_contract");
  const observed = observedFields(app);
  let source: Json;
  let differences: string[];

  if (item.basis === "validation_contract") {
    source = { expectedStatus: item.expectedStatus, expectedError: String(item.expectedError) };
    differences = [
      ...(response.status === item.expectedStatus ? [] : ["httpStatus"]),
      ...(item.expectedError?.test(String(app.error)) ? [] : ["error"]),
    ];
  } else if (item.basis === "safety_contract") {
    source = { verdict: "official_handoff", state: item.input.state, medicaidEligible: false, aptcMonthly: 0, inCoverageGap: false, planCount: null, cheapestPremiumMonthly: null };
    differences = compare(source, observed);
  } else if (item.basis === "cms_2026_exchange_list") {
    source = { verdict: "state_marketplace", state: item.input.state, medicaidEligible: false, aptcMonthly: 0, inCoverageGap: false, planCount: null, cheapestPremiumMonthly: null, exchange: item.expectedName };
    differences = compare({ verdict: source.verdict, state: source.state, medicaidEligible: false, aptcMonthly: 0, inCoverageGap: false, planCount: null, cheapestPremiumMonthly: null }, observed);
    if (!Array.isArray(app.nextSteps) || !app.nextSteps.some((step) => typeof step === "string" && step.includes(item.expectedName ?? ""))) differences.push("exchangeName");
  } else {
    const geo = await official(`/counties/by/zip/${item.input.zip}`, "GET");
    const counties = Array.isArray(geo.counties) ? geo.counties as Json[] : [];
    const county = counties[0];
    if (!county || typeof county.fips !== "string" || typeof county.state !== "string") throw new Error("cms_county_unresolved");
    if (item.basis === "direct_cms_geography") {
      if (county.state === item.input.state) throw new Error("geography_fixture_no_longer_mismatches");
      source = { state: item.input.state, county: county.name, verdict: "unknown", medicaidEligible: false, aptcMonthly: 0, inCoverageGap: false, planCount: null, cheapestPremiumMonthly: null, cmsCountyState: county.state };
      differences = compare({ state: source.state, county: source.county, verdict: source.verdict, medicaidEligible: false, aptcMonthly: 0, inCoverageGap: false, planCount: null, cheapestPremiumMonthly: null }, observed);
    } else {
      if (county.state !== item.input.state) throw new Error("cms_county_state_mismatch");
      const place = { zipcode: item.input.zip, countyfips: county.fips, state: county.state };
      const household = { income: item.input.income, people: [{ age: item.input.age }] };
      const estimate = await official("/households/eligibility/estimates", "POST", { household, place, year: YEAR });
      const firstEstimate = Array.isArray(estimate.estimates) ? estimate.estimates[0] as Json | undefined : undefined;
      if (!firstEstimate) throw new Error("cms_estimate_missing");
      const search = await official("/plans/search", "POST", { household, market: "Individual", place, year: YEAR, limit: 10, offset: 0 });
      const plans = Array.isArray(search.plans) ? search.plans as Json[] : [];
      const premiums = plans.map((plan) => plan.premium).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const missingSourceFields = [
        ...(["is_medicaid_chip", "aptc", "in_coverage_gap"] as const).filter((field) => firstEstimate[field] === undefined),
        ...(typeof search.total === "number" ? [] : ["planCount"]),
      ];
      const medicaidEligible = Boolean(firstEstimate.is_medicaid_chip);
      const aptcMonthly = Math.round(typeof firstEstimate.aptc === "number" ? firstEstimate.aptc : 0);
      const inCoverageGap = Boolean(firstEstimate.in_coverage_gap);
      const planCount = search.total;
      const verdict = inCoverageGap ? "coverage_gap" : medicaidEligible ? "medicaid" : aptcMonthly > 0 || (typeof planCount === "number" && planCount > 0) ? "marketplace" : "unknown";
      source = { state: county.state, county: county.name, verdict, medicaidEligible, aptcMonthly, inCoverageGap, planCount, cheapestPremiumMonthly: premiums.length ? Math.min(...premiums) : null, missingSourceFields };
      differences = compare({ state: source.state, county: source.county, verdict, medicaidEligible, aptcMonthly, inCoverageGap, planCount, cheapestPremiumMonthly: source.cheapestPremiumMonthly }, observed);
      differences.push(...missingSourceFields.map((field) => `source_missing.${field}`));
    }
  }
  return { id: item.id, basis: item.basis, input: item.input, source, observed: item.basis === "validation_contract" ? { status: response.status, error: app.error } : observed, differences, checkedAt: new Date().toISOString() };
}

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    console.log(JSON.stringify(CASES.map(({ id, basis }) => ({ id, basis })), null, 2));
    return;
  }
  if (!process.env.MARKETPLACE_API_KEY?.trim()) throw new Error("marketplace_key_unset");
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && !process.argv[outputIndex + 1]) throw new Error("output_path_missing");
  const cases: Json[] = [];
  for (const item of CASES) {
    try {
      const result = await evaluate(item);
      cases.push(result);
      console.log(`${(result.differences as string[]).length ? "DIFF" : "PASS"} ${item.id}`);
    } catch (error) {
      const category = error instanceof Error && /^(cms|app)_http_\d{3}$|^cms_(county_unresolved|county_state_mismatch|estimate_missing)$|^geography_fixture_no_longer_mismatches$/.test(error.message)
        ? error.message
        : error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "source_timeout"
          : error instanceof TypeError
            ? "source_network_error"
            : "source_pair_unavailable";
      cases.push({ id: item.id, basis: item.basis, input: item.input, unavailable: category, checkedAt: new Date().toISOString() });
      console.log(`UNAVAILABLE ${item.id} ${category}`);
    }
  }
  const paired = cases.filter((row) => !row.unavailable);
  const mismatched = paired.filter((row) => Array.isArray(row.differences) && row.differences.length > 0);
  const report = {
    evaluatedAt: new Date().toISOString(), app: APP_URL, planYear: YEAR,
    liveCommit: process.env.AFFINITY_LIVE_COMMIT ?? "unverified",
    sources: { cmsApi: "https://developer.cms.gov/marketplace-api/api-spec", exchangeClassification: CMS_EXCHANGES },
    scope: "30 synthetic live eligibility requests; evidence bases differ by case; not plan-board, enrollment, independent coverage truth, human-use, or accessibility validation",
    counts: { planned: CASES.length, evaluated: paired.length, mismatched: mismatched.length, unavailable: CASES.length - paired.length,
      byBasis: Object.fromEntries((["direct_cms_full", "direct_cms_geography", "cms_2026_exchange_list", "safety_contract", "validation_contract"] as Basis[]).map((basis) => [basis, { planned: CASES.filter((row) => row.basis === basis).length, evaluated: paired.filter((row) => row.basis === basis).length, mismatched: mismatched.filter((row) => row.basis === basis).length }])) },
    cases,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputIndex >= 0) await writeFile(process.argv[outputIndex + 1], json, { flag: "wx" });
  else console.log(json);
  if (mismatched.length || paired.length !== CASES.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error && /^(marketplace_key_unset|output_path_missing|EEXIST)$/.test(error.message) ? error.message : "live_matrix_failed");
  process.exitCode = 1;
});
