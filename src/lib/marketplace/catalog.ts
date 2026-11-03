/** Strict, data-only contract shared by the source updater and the application. */
export interface CatalogMarketplace { state: string; name: string; url: string }
export interface CatalogYear {
  models: Record<string, "FFM" | "FFMPartnership" | "SupportedSBM" | "SBM">;
  marketplaces: Record<string, CatalogMarketplace>;
}
export interface MarketplaceCatalog {
  schemaVersion: 1;
  checkedAt: string;
  expiresAt: string;
  defaultYear: number;
  years: Record<string, CatalogYear>;
  evidence: { source: string; advertisedYears: number[]; probedYears: number[]; probeProfiles: number };
}

export const CATALOG_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const MODEL_VALUES = new Set(["FFM", "FFMPartnership", "SupportedSBM", "SBM"]);
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function assertCatalog(value: unknown, codes: readonly string[]): asserts value is MarketplaceCatalog {
  if (!object(value) || value.schemaVersion !== 1 || !object(value.years) || !object(value.evidence)) throw new Error("catalog_invalid");
  const checked = Date.parse(String(value.checkedAt));
  const expires = Date.parse(String(value.expiresAt));
  if (!Number.isFinite(checked) || !Number.isFinite(expires) || expires <= checked || expires - checked > CATALOG_MAX_AGE_MS) throw new Error("catalog_dates_invalid");
  const years = Object.keys(value.years);
  if (!years.length || years.length > 5 || !Number.isInteger(value.defaultYear) || !years.includes(String(value.defaultYear)) || years.some((year) => !/^20\d{2}$/.test(year))) throw new Error("catalog_years_invalid");
  if (codes.length !== 51 || new Set(codes).size !== 51) throw new Error("catalog_state_universe_invalid");
  for (const year of years) {
    const entry = value.years[year];
    if (!object(entry) || !object(entry.models) || !object(entry.marketplaces)
      || Object.keys(entry.models).length !== 51 || codes.some((code) => !MODEL_VALUES.has(String((entry.models as Record<string, unknown>)[code])))) throw new Error("catalog_states_incomplete");
    const expected = codes.filter((code) => (entry.models as Record<string, unknown>)[code] === "SBM").sort();
    if (JSON.stringify(Object.keys(entry.marketplaces).sort()) !== JSON.stringify(expected)) throw new Error("catalog_marketplaces_incomplete");
    for (const record of Object.values(entry.marketplaces)) {
      if (!object(record) || typeof record.state !== "string" || !record.state.trim() || typeof record.name !== "string" || !record.name.trim() || typeof record.url !== "string") throw new Error("catalog_marketplace_invalid");
      const url = new URL(`https://${record.url}`);
      if (url.username || url.password || url.hash || url.hostname === "localhost" || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || record.url.includes(":") || record.url.length > 300) throw new Error("catalog_marketplace_url_invalid");
    }
  }
  const evidence = value.evidence;
  const advertised = evidence.advertisedYears;
  const probed = evidence.probedYears;
  if (evidence.source !== "https://marketplace.api.healthcare.gov/api/v1" || !Array.isArray(advertised) || !Array.isArray(probed)
    || years.some((year) => !advertised.includes(Number(year)) || !probed.includes(Number(year)))
    || !Number.isInteger(evidence.probeProfiles) || Number(evidence.probeProfiles) !== years.length * 5) throw new Error("catalog_evidence_invalid");
}

export function catalogFreshness(catalog: MarketplaceCatalog, now = Date.now()) {
  const checked = Date.parse(catalog.checkedAt);
  const expires = Date.parse(catalog.expiresAt);
  return { status: now >= checked && now < expires ? "current" as const : "stale" as const, checkedAt: catalog.checkedAt, expiresAt: catalog.expiresAt };
}

/** Ignore receipt timestamps when deciding if an unchanged source needs a new publication. */
export function catalogNeedsPublication(previous: MarketplaceCatalog | undefined, candidate: MarketplaceCatalog, now = Date.now()): boolean {
  if (!previous) return true;
  const content = (v: MarketplaceCatalog) => JSON.stringify({ defaultYear: v.defaultYear, years: v.years });
  return content(previous) !== content(candidate) || now - Date.parse(previous.checkedAt) >= 6 * 24 * 60 * 60 * 1000;
}
