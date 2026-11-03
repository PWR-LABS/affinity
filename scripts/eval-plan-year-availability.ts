/**
 * Bounded 2027 source-availability audit. Fixed synthetic one-person profiles;
 * one page per profile, no cache, no raw CMS bodies or keyed URLs in evidence.
 * A completed audit never enables a plan year or certifies quote accuracy.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const CMS = "https://marketplace.api.healthcare.gov/api/v1";
const APP = "https://affinity.pwr-labs.ai";
const TARGET_YEAR = 2027;
const SUPPORTED_YEAR_AT_AUDIT = 2026;
type Json = Record<string, unknown>;
const record = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

const PROFILES = [
  { id: "oh-control-2026", state: "OH", zip: "44106", income: 45_000, age: 50, year: 2026 },
  { id: "oh-2027", state: "OH", zip: "44106", income: 45_000, age: 50, year: TARGET_YEAR },
  { id: "fl-2027", state: "FL", zip: "33101", income: 28_000, age: 35, year: TARGET_YEAR },
  { id: "tx-2027", state: "TX", zip: "77002", income: 48_000, age: 45, year: TARGET_YEAR },
  { id: "ar-2027", state: "AR", zip: "72201", income: 35_000, age: 40, year: TARGET_YEAR },
  { id: "ok-2027", state: "OK", zip: "73104", income: 35_000, age: 40, year: TARGET_YEAR },
] as const;

interface Options { apiKey: string; sourceCommit: string; harnessSha256: string; fetchImpl?: typeof fetch }
interface ReadResult { httpStatus: number | null; body?: unknown; error?: string }

export async function auditPlanYearAvailability(options: Options) {
  if (!options.apiKey.trim()) throw new Error("marketplace_key_unset");
  const fetchImpl = options.fetchImpl ?? fetch;
  async function read(origin: string, path: string, body?: Json): Promise<ReadResult> {
    const url = new URL(origin + path);
    if (origin === CMS) url.searchParams.set("apikey", options.apiKey);
    try {
      const response = await fetchImpl(url, {
        method: body ? "POST" : "GET",
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      // App guard probes deliberately inspect HTTP 400; never retain its raw error.
      if (!response.ok && !(origin === APP && response.status === 400)) return { httpStatus: response.status, error: "http_error" };
      try { return { httpStatus: response.status, body: await response.json() }; }
      catch { return { httpStatus: response.status, error: "invalid_json" }; }
    } catch { return { httpStatus: null, error: "source_unavailable" }; }
  }
  const status = (result: ReadResult) => ({ httpStatus: result.httpStatus, ...(result.error ? { error: result.error } : {}) });
  async function health(path: string) {
    const response = await read(APP, path);
    const data = record(response.body);
    const release = record(data.release);
    const checks = record(data.checks);
    return {
      ...status(response),
      healthy: response.httpStatus === 200 && data.status === "ok",
      commit: typeof release.commit === "string" && /^[a-f0-9]{40}$/.test(release.commit) ? release.commit : null,
      marketplaceApiOk: checks.marketplaceApi === "ok",
    };
  }

  const startedAt = new Date().toISOString();
  const before = await health("/api/health?deep=1");
  const profiles: Json[] = [];
  let ohioPlanIds: string[] = [];
  for (const profile of PROFILES) {
    const geo = await read(CMS, `/counties/by/zip/${profile.zip}`);
    const counties = record(geo.body).counties;
    const county = Array.isArray(counties) && counties.length === 1 ? record(counties[0]) : {};
    const uniqueCounty = county.state === profile.state && typeof county.fips === "string" && /^\d{5}$/.test(county.fips);
    if (!uniqueCounty) {
      profiles.push({ input: profile, available: false, geography: { ...status(geo), uniqueCounty: false } });
      continue;
    }
    const place = { zipcode: profile.zip, countyfips: county.fips, state: profile.state };
    const household = { income: profile.income, people: [{ age: profile.age }] };
    const eligibility = await read(CMS, "/households/eligibility/estimates", { household, place, year: profile.year });
    const estimates = record(eligibility.body).estimates;
    const estimate = Array.isArray(estimates) && estimates.length === 1 ? record(estimates[0]) : {};
    const eligibilityValid = nonnegative(estimate.aptc) && typeof estimate.is_medicaid_chip === "boolean" && typeof estimate.in_coverage_gap === "boolean";
    const search = await read(CMS, "/plans/search", { household, market: "Individual", place, year: profile.year, limit: 10, offset: 0 });
    const searchData = record(search.body);
    const plans = Array.isArray(searchData.plans) ? searchData.plans.map(record) : [];
    const plansValid = plans.length > 0 && plans.length <= 10 && Number.isInteger(searchData.total) && Number(searchData.total) >= plans.length
      && plans.every((plan) => typeof plan.id === "string" && new RegExp(`^\\d{5}${profile.state}\\d{7}$`).test(plan.id) && plan.state === profile.state && nonnegative(plan.premium) && (plan.year === undefined || plan.year === profile.year));
    if (profile.id === "oh-2027" && plansValid) ohioPlanIds = plans.map((plan) => String(plan.id));
    profiles.push({
      input: profile,
      available: eligibilityValid && plansValid,
      geography: { ...status(geo), uniqueCounty: true, countyFips: county.fips },
      eligibility: { ...status(eligibility), expectedFieldsPresent: eligibilityValid },
      planSearch: {
        ...status(search), expectedFieldsPresent: plansValid, sampledRows: plans.length,
        totalPlans: Number.isInteger(searchData.total) && Number(searchData.total) >= 0 ? searchData.total : null,
        explicitYearFields: plans.filter((plan) => plan.year === profile.year).length,
        planDocumentUrlsMentioningRequestedYear: plans.filter((plan) => [plan.benefits_url, plan.brochure_url].some((url) => typeof url === "string" && url.includes(String(profile.year)))).length,
      },
    });
  }

  const provider = await read(CMS, `/providers/autocomplete?q=Smith&zipcode=44106&type=Individual&year=${TARGET_YEAR}`);
  const providers = Array.isArray(provider.body) ? provider.body.map(record) : [];
  const npi = providers.find((item) => typeof item.npi === "string" && /^\d{10}$/.test(item.npi))?.npi;
  const drug = await read(CMS, "/drugs/autocomplete?q=ibuprofen");
  const drugs = Array.isArray(drug.body) ? drug.body.map(record) : [];
  const rxcui = drugs.find((item) => typeof item.rxcui === "string" && /^\d+$/.test(item.rxcui))?.rxcui;
  async function coverage(subject: unknown, param: string, path: string) {
    if (!subject || !ohioPlanIds.length) return { httpStatus: null, observed: false, rowsReturned: null, rowsWithExplicitCoverage: null, error: "lookup_prerequisite_unavailable" };
    const response = await read(CMS, `${path}?${param}=${encodeURIComponent(String(subject))}&planids=${ohioPlanIds.join(",")}&year=${TARGET_YEAR}`);
    const rows = record(response.body).coverage;
    return {
      ...status(response), observed: response.httpStatus === 200 && Array.isArray(rows),
      rowsReturned: Array.isArray(rows) ? rows.length : null,
      // Missing rows or status fields remain unknown, never a claim of noncoverage.
      rowsWithExplicitCoverage: Array.isArray(rows) ? rows.filter((row) => typeof record(row).coverage === "string").length : null,
    };
  }
  const lookups = {
    providerAutocomplete: { ...status(provider), observed: Boolean(npi), suggestionCount: providers.length },
    drugAutocomplete: { ...status(drug), observed: Boolean(rxcui), suggestionCount: drugs.length, yearScoped: false },
    providerCoverage: await coverage(npi, "providerids", "/providers/covered"),
    drugCoverage: await coverage(rxcui, "drugs", "/drugs/covered"),
  };
  const guards = [];
  for (const [path, input] of [
    ["/api/eligibility", { state: "OH", zip: "44106", income: 45_000, age: 50, householdSize: 1, year: TARGET_YEAR }],
    ["/api/plans", { zip: "44106", income: 45_000, age: 50, householdSize: 1, year: TARGET_YEAR, doctors: [], drugs: [] }],
    ["/api/providers/autocomplete", { q: "Smith", zip: "44106", year: TARGET_YEAR }],
  ] as const) {
    const response = await read(APP, path, input);
    guards.push({ path, ...status(response), rejectsTargetYear: response.httpStatus === 400 && record(response.body).error === `This comparison currently supports ${SUPPORTED_YEAR_AT_AUDIT} only.` });
  }
  const after = await health("/api/health?deep=1");
  const releaseStable = before.commit !== null && before.commit === after.commit;
  const available = profiles.filter((profile) => profile.available).length;
  return {
    schemaVersion: 1, startedAt, completedAt: new Date().toISOString(), targetYear: TARGET_YEAR,
    sourceCommit: options.sourceCommit, harnessSha256: options.harnessSha256,
    sourceApi: CMS, app: APP,
    scope: "Six synthetic one-person source probes (five 2027, one 2026 control); first page only. Four lookup probes and three deployed 2027 rejection guards. No independent quote/coverage verification or consumer-use certification.",
    readiness: "NOT_ENABLED",
    production: { before, after, releaseStable, sourceCommitMatchesRelease: before.commit === options.sourceCommit },
    counts: { plannedProfiles: PROFILES.length, availableProfiles: available, unavailableProfiles: PROFILES.length - available },
    profiles, lookups, guards,
    observationsComplete: available === PROFILES.length && Object.values(lookups).every((item) => item.observed)
      && guards.every((guard) => guard.rejectsTargetYear) && releaseStable && before.healthy && before.marketplaceApiOk && after.healthy && after.marketplaceApiOk,
  };
}

async function main() {
  const apiKey = process.env.MARKETPLACE_API_KEY?.trim();
  if (!apiKey) throw new Error("marketplace_key_unset");
  const result = await auditPlanYearAvailability({
    apiKey, sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    harnessSha256: createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.observationsComplete) process.exitCode = 1;
}

if (process.argv[1] && basename(process.argv[1]) === "eval-plan-year-availability.ts") {
  main().catch(() => { console.error("plan_year_audit_unavailable; check local key configuration and source access"); process.exitCode = 1; });
}
