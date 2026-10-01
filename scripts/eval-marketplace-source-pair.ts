/**
 * Compare five prewritten synthetic eligibility cases on the deployed app with
 * direct, same-day responses from the official CMS Marketplace API. This is a
 * method check, not the full 30-profile pilot protocol or an eligibility finding.
 *
 * Run with MARKETPLACE_API_KEY already in the environment. The key, keyed URLs,
 * raw upstream bodies, and any real person-level inputs must not be printed.
 */
const APP_URL = "https://affinity.pwr-labs.ai";
const CMS_API = "https://marketplace.api.healthcare.gov/api/v1";
const YEAR = 2026;

interface Profile {
  id: string;
  state: string;
  zip: string;
  income: number;
  age: number;
}

const PROFILES: readonly Profile[] = [
  { id: "oh-low-income", state: "OH", zip: "44106", income: 16_000, age: 30 },
  { id: "oh-mid-income", state: "OH", zip: "44106", income: 45_000, age: 50 },
  { id: "fl-low-income", state: "FL", zip: "33101", income: 12_000, age: 35 },
  { id: "tx-mid-income", state: "TX", zip: "77002", income: 48_000, age: 45 },
  { id: "wi-high-income", state: "WI", zip: "53703", income: 100_000, age: 60 },
];

type Json = Record<string, unknown>;

async function readJson(response: Response, source: string): Promise<Json> {
  if (!response.ok) throw new Error(`${source} HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`${source} returned a non-object`);
  return body as Json;
}

async function official(path: string, method: "GET" | "POST", body?: Json): Promise<Json> {
  const key = process.env.MARKETPLACE_API_KEY?.trim();
  if (!key) throw new Error("MARKETPLACE_API_KEY is unset");
  const url = new URL(`${CMS_API}${path}`);
  url.searchParams.set("apikey", key);
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Never include the keyed URL or raw response body in an error.
  return readJson(response, `CMS ${path.split("?")[0]}`);
}

async function evaluate(profile: Profile): Promise<Json> {
  const input = { state: profile.state, zip: profile.zip, income: profile.income, age: profile.age, householdSize: 1, year: YEAR };
  const app = await readJson(await fetch(`${APP_URL}/api/eligibility`, {
    method: "POST",
    signal: AbortSignal.timeout(25_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  }), "[affinity.] eligibility");

  const geo = await official(`/counties/by/zip/${profile.zip}`, "GET");
  const counties = Array.isArray(geo.counties) ? geo.counties as Json[] : [];
  const county = counties[0];
  if (!county || county.state !== profile.state || typeof county.fips !== "string") {
    throw new Error("CMS county lookup did not resolve to the prewritten state");
  }
  const place = { zipcode: profile.zip, countyfips: county.fips, state: county.state };
  const household = { income: profile.income, people: [{ age: profile.age }] };
  const estimate = await official("/households/eligibility/estimates", "POST", { household, place, year: YEAR });
  const firstEstimate = Array.isArray(estimate.estimates) ? estimate.estimates[0] as Json | undefined : undefined;
  if (!firstEstimate) throw new Error("CMS returned no eligibility estimate");
  const search = await official("/plans/search", "POST", { household, market: "Individual", place, year: YEAR, limit: 10, offset: 0 });
  const plans = Array.isArray(search.plans) ? search.plans as Json[] : [];
  const premiums = plans.map((plan) => plan.premium).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const source = {
    state: county.state,
    county: county.name,
    medicaidEligible: Boolean(firstEstimate.is_medicaid_chip),
    aptcMonthly: Math.round(typeof firstEstimate.aptc === "number" ? firstEstimate.aptc : 0),
    inCoverageGap: Boolean(firstEstimate.in_coverage_gap),
    planCount: search.total,
    cheapestPremiumMonthly: premiums.length ? Math.min(...premiums) : null,
  };
  const sourceVerdict = source.inCoverageGap
    ? "coverage_gap"
    : source.medicaidEligible
      ? "medicaid"
      : source.aptcMonthly > 0 || (typeof source.planCount === "number" && source.planCount > 0)
        ? "marketplace"
        : "unknown";
  const observed = {
    state: app.state,
    county: app.county,
    verdict: app.verdict,
    medicaidEligible: app.medicaidEligible,
    aptcMonthly: app.aptcMonthly,
    inCoverageGap: app.inCoverageGap,
    planCount: app.planCount,
    cheapestPremiumMonthly: app.cheapestPremiumMonthly ?? null,
  };
  const differences: string[] = (Object.keys(source) as Array<keyof typeof source>).filter((field) => source[field] !== observed[field]);
  if (sourceVerdict !== observed.verdict) differences.push("verdict");
  return { id: profile.id, input, source: { ...source, verdict: sourceVerdict }, observed, differences, pairedAt: new Date().toISOString() };
}

async function main(): Promise<void> {
  if (!process.env.MARKETPLACE_API_KEY?.trim()) throw new Error("MARKETPLACE_API_KEY is unset");
  const cases: Json[] = [];
  for (const profile of PROFILES) {
    try {
      cases.push(await evaluate(profile));
    } catch (error) {
      // Keep the error coarse. Fetch exceptions may otherwise contain a URL with the API key.
      cases.push({ id: profile.id, input: { state: profile.state, zip: profile.zip, income: profile.income, age: profile.age, householdSize: 1, year: YEAR }, error: error instanceof Error && /HTTP \d{3}/.test(error.message) ? error.message : "source_pair_unavailable" });
    }
  }
  const paired = cases.filter((row) => !row.error);
  const mismatched = paired.filter((row) => Array.isArray(row.differences) && row.differences.length > 0);
  console.log(JSON.stringify({
    evaluatedAt: new Date().toISOString(),
    app: APP_URL,
    source: "https://developer.cms.gov/marketplace-api/api-spec",
    sourceApi: CMS_API,
    year: YEAR,
    scope: "Five synthetic one-person eligibility profiles; direct official API response versus live app; not full plan-board, enrollment, or human-use validation",
    counts: { planned: PROFILES.length, paired: paired.length, mismatched: mismatched.length, unavailable: cases.length - paired.length },
    cases,
  }, null, 2));
  if (mismatched.length || paired.length !== PROFILES.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error && error.message === "MARKETPLACE_API_KEY is unset" ? error.message : "source_pair_unavailable");
  process.exitCode = 1;
});
