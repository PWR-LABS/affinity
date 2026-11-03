/** Official-source catalog refresh. Fixed synthetic probes; never logs keyed URLs or raw bodies. */
import { writeFile, readFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";
import { assertCatalog, catalogNeedsPublication, CATALOG_MAX_AGE_MS, type CatalogYear, type MarketplaceCatalog } from "@/lib/marketplace/catalog";

const SOURCE = "https://marketplace.api.healthcare.gov/api/v1";
export const CATALOG_FILE = "src/lib/marketplace/catalog-data.json";
const PROFILES = [
  { state: "OH", zip: "44106", age: 50, income: 45_000 },
  { state: "FL", zip: "33101", age: 35, income: 28_000 },
  { state: "TX", zip: "77002", age: 45, income: 48_000 },
  { state: "AR", zip: "72201", age: 40, income: 35_000 },
  { state: "OK", zip: "73104", age: 40, income: 35_000 },
] as const;
type Json = Record<string, unknown>;
const asObject = (v: unknown): Json => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Json : {};

export async function buildCatalog(options: { apiKey: string; previous?: MarketplaceCatalog; fetchImpl?: typeof fetch; now?: number }) {
  if (!options.apiKey.trim()) throw new Error("marketplace_key_unset");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  async function read(path: string, body?: Json): Promise<Json> {
    const url = new URL(SOURCE + path);
    url.searchParams.set("apikey", options.apiKey);
    try {
      const response = await fetchImpl(url, { method: body ? "POST" : "GET", headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!response.ok) throw new Error("source_unavailable");
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("source_invalid");
      return data as Json;
    } catch { throw new Error("official_source_unavailable_or_invalid"); }
  }
  const advertised = await read("/market-years");
  if (!Array.isArray(advertised.supported) || advertised.supported.some((year) => !Number.isInteger(year) || year < 2000 || year > 2099)
    || !Number.isInteger(advertised.current) || !advertised.supported.includes(advertised.current)) throw new Error("advertised_years_invalid");
  const current = Number(advertised.current);
  const supported = advertised.supported as number[];
  // Preserve existing accepted years while adding the official current year and an advertised next year.
  const wanted = [...new Set([...(options.previous ? Object.keys(options.previous.years).map(Number) : [current - 1]), current, current + 1])]
    .filter((year) => supported.includes(year)).sort((a, b) => a - b);
  if (wanted.length > 5) throw new Error("catalog_retention_review_required");
  const codes = STATE_MEDICAID_RESOURCES.map((row) => row.code);
  const years: Record<string, CatalogYear> = {};
  const outcomes: Array<{ year: number; state: string; status: string }> = [];
  const deferredYears: number[] = [];
  for (const year of wanted) {
    const outcomeStart = outcomes.length;
    try {
    const source = await read(`/states?year=${year}`);
    if (!Array.isArray(source.states)) throw new Error("state_catalog_invalid");
    const models: CatalogYear["models"] = {};
    const marketplaces: CatalogYear["marketplaces"] = {};
    for (const state of source.states.map(asObject)) {
      if (typeof state.abbrev !== "string" || !codes.includes(state.abbrev)) continue; // Territories are not in the app's 51-jurisdiction scope.
      const code = state.abbrev;
      if (models[code]) throw new Error("duplicate_state_record");
      if (!["FFM", "FFMPartnership", "SupportedSBM", "SBM"].includes(String(state.marketplace_model))) throw new Error("unknown_marketplace_model");
      models[code] = state.marketplace_model as CatalogYear["models"][string];
      if (state.marketplace_model === "SBM") {
        if (typeof state.hix_name !== "string" || typeof state.hix_url !== "string" || typeof state.name !== "string") throw new Error("state_handoff_missing");
        const url = new URL(state.hix_url);
        if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("state_handoff_requires_review");
        marketplaces[code] = { state: state.name, name: state.hix_name, url: `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}` };
      }
    }
    if (Object.keys(models).length !== 51 || codes.some((code) => !models[code])) throw new Error("state_catalog_incomplete");
    for (const profile of PROFILES) {
      if (models[profile.state] === "SBM") { outcomes.push({ year, state: profile.state, status: "official_state_handoff" }); continue; }
      const geo = await read(`/counties/by/zip/${profile.zip}`);
      const counties = Array.isArray(geo.counties) ? geo.counties.map(asObject) : [];
      if (counties.length !== 1 || counties[0].state !== profile.state || typeof counties[0].fips !== "string") throw new Error("probe_geography_unresolved");
      const household = { income: profile.income, people: [{ age: profile.age }] };
      const place = { zipcode: profile.zip, countyfips: counties[0].fips, state: profile.state };
      const eligibility = await read("/households/eligibility/estimates", { household, place, year });
      const estimate = Array.isArray(eligibility.estimates) && eligibility.estimates.length === 1 ? asObject(eligibility.estimates[0]) : {};
      if (typeof estimate.aptc !== "number" || !Number.isFinite(estimate.aptc) || estimate.aptc < 0 || typeof estimate.is_medicaid_chip !== "boolean" || typeof estimate.in_coverage_gap !== "boolean") throw new Error("probe_eligibility_incomplete");
      const search = await read("/plans/search", { household, place, year, market: "Individual", limit: 10, offset: 0 });
      const plans = Array.isArray(search.plans) ? search.plans.map(asObject) : [];
      if (!plans.length || plans.length > 10 || !Number.isInteger(search.total) || Number(search.total) < plans.length || plans.some((plan) => plan.state !== profile.state || typeof plan.id !== "string" || !new RegExp(`^\\d{5}${profile.state}\\d{7}$`).test(plan.id) || typeof plan.premium !== "number" || !Number.isFinite(plan.premium) || plan.premium < 0 || (plan.year !== undefined && plan.year !== year))) throw new Error("probe_plans_incomplete_or_wrong_year");
      outcomes.push({ year, state: profile.state, status: "source_available" });
    }
    years[String(year)] = {
      models: Object.fromEntries(Object.keys(models).sort().map((code) => [code, models[code]])),
      marketplaces: Object.fromEntries(Object.keys(marketplaces).sort().map((code) => [code, marketplaces[code]])),
    };
    } catch (error) {
      // Advertising a future year does not mean its prices are ready. Keep refreshing the accepted years.
      if (year > current && !options.previous?.years[String(year)]) { outcomes.splice(outcomeStart); deferredYears.push(year); continue; }
      throw error;
    }
  }
  const candidate: MarketplaceCatalog = { schemaVersion: 1, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + CATALOG_MAX_AGE_MS).toISOString(), defaultYear: current, years,
    evidence: { source: SOURCE, advertisedYears: [...supported].sort((a, b) => a - b), probedYears: Object.keys(years).map(Number), probeProfiles: outcomes.length } };
  assertCatalog(candidate, codes);
  return { candidate, outcomes, deferredYears, changed: catalogNeedsPublication(options.previous, candidate, now) };
}

async function main() {
  let previous: MarketplaceCatalog | undefined;
  try { previous = JSON.parse(await readFile(CATALOG_FILE, "utf8")); assertCatalog(previous, STATE_MEDICAID_RESOURCES.map((row) => row.code)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("previous_catalog_invalid"); }
  const result = await buildCatalog({ apiKey: process.env.MARKETPLACE_API_KEY ?? "", previous });
  const serialized = JSON.stringify(result.candidate, null, 2) + "\n";
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/catalog-refresh-report.json", JSON.stringify({ status: "verified", checkedAt: result.candidate.checkedAt, changed: result.changed, candidateSha256: createHash("sha256").update(serialized).digest("hex"), defaultYear: result.candidate.defaultYear, years: Object.keys(result.candidate.years), outcomes: result.outcomes, deferredYears: result.deferredYears, scope: "Official year/platform metadata and five synthetic availability probes per year; not independent coverage or policy review" }, null, 2) + "\n");
  if (result.changed) {
    const temporary = `${CATALOG_FILE}.pending`;
    await writeFile(temporary, serialized);
    await rename(temporary, CATALOG_FILE);
  }
  console.log(JSON.stringify({ changed: result.changed, years: Object.keys(result.candidate.years), defaultYear: result.candidate.defaultYear, probes: result.outcomes.length }));
}

if (process.argv[1]?.endsWith("update-marketplace-catalog.ts")) main().catch(async (error) => {
  const allowed = new Set(["marketplace_key_unset", "official_source_unavailable_or_invalid", "advertised_years_invalid", "catalog_retention_review_required", "state_catalog_invalid", "duplicate_state_record", "unknown_marketplace_model", "state_handoff_missing", "state_handoff_requires_review", "state_catalog_incomplete", "probe_geography_unresolved", "probe_eligibility_incomplete", "probe_plans_incomplete_or_wrong_year", "previous_catalog_invalid", "catalog_invalid", "catalog_dates_invalid", "catalog_years_invalid", "catalog_states_incomplete", "catalog_marketplaces_incomplete", "catalog_marketplace_invalid", "catalog_marketplace_url_invalid", "catalog_evidence_invalid"]);
  const reason = error instanceof Error && allowed.has(error.message) ? error.message : "unclassified_refresh_failure";
  try { await mkdir("tmp", { recursive: true }); await writeFile("tmp/catalog-refresh-report.json", JSON.stringify({ status: "failed", reason, observedAt: new Date().toISOString(), previousCatalogPreserved: true }) + "\n"); } catch { /* No raw exception output. */ }
  console.error(`catalog_refresh_failed: ${reason}; last accepted catalog preserved`);
  process.exitCode = 1;
});
