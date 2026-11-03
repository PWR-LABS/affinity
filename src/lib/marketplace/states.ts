/**
 * State-Based Marketplaces (SBMs) — states that run their OWN ACA exchange on their OWN platform,
 * instead of the federal HealthCare.gov platform. The Marketplace API (marketplace.api.healthcare.gov)
 * only serves the federally-facilitated states, so for an SBM state we can't pull live plans or the
 * subsidy estimate. Rather than fail with a misleading "couldn't reach the Marketplace, try again," we
 * detect the state up front (from the ZIP's county) and send people to their own marketplace — where
 * their real plans and subsidies live.
 *
 * Plan-year 2026 authority: CMS lists 21 full-platform SBMs and 3 SBM-FP states.
 * https://www.cms.gov/CCIIO/Resources/Fact-Sheets-and-FAQs/state-marketplaces
 * SBM-FP states (Arkansas, Oregon, Oklahoma) still use the federal eligibility/enrollment platform
 * for 2026 and are intentionally absent from that year's table. The CMS 2027 map moves
 * Oregon to its own platform, leaving Arkansas and Oklahoma on the federal platform:
 * https://www.cms.gov/marketplace/in-person-assisters/training-webinars/training/marketplaces-map
 * Omitting a full SBM is unsafe:
 * it can produce a federal estimate where users need their own state's exchange.
 */
import catalogData from "./catalog-data.json";
import { assertCatalog, catalogFreshness, type MarketplaceCatalog } from "./catalog";
import { STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";

assertCatalog(catalogData, STATE_MEDICAID_RESOURCES.map((state) => state.code));
export const MARKETPLACE_CATALOG: MarketplaceCatalog = catalogData;

export interface StateMarketplace {
  /** Full state name, for prose. */
  state: string;
  /** The marketplace's brand name. */
  name: string;
  /** Bare domain (no scheme), so the UI can render it as text or a link. */
  url: string;
}

export const SUPPORTED_MARKETPLACE_PLAN_YEARS = Object.keys(MARKETPLACE_CATALOG.years).map(Number).sort((a, b) => a - b);
export type MarketplacePlanYear = number;
/** The validated official current year; never inferred from a device clock. */
export const DEFAULT_MARKETPLACE_PLAN_YEAR = MARKETPLACE_CATALOG.defaultYear;
export const MARKETPLACE_PLAN_YEAR_ERROR = `Choose ${SUPPORTED_MARKETPLACE_PLAN_YEARS.join(" or ")} coverage.`;
export const marketplaceCatalogFreshness = (now = Date.now()) => catalogFreshness(MARKETPLACE_CATALOG, now);

export function parseMarketplacePlanYear(value: unknown): MarketplacePlanYear | undefined {
  if (value === undefined) return DEFAULT_MARKETPLACE_PLAN_YEAR;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d{4}$/.test(value.trim()))) return undefined;
  const year = Number(value);
  return SUPPORTED_MARKETPLACE_PLAN_YEARS.find((supported) => supported === year);
}

export class UnsupportedMarketplacePlanYearError extends Error {
  constructor() {
    super(MARKETPLACE_PLAN_YEAR_ERROR);
    this.name = "UnsupportedMarketplacePlanYearError";
  }
}

export function assertMarketplacePlanYear(year: number): asserts year is MarketplacePlanYear {
  if (!SUPPORTED_MARKETPLACE_PLAN_YEARS.some((supported) => supported === year)) throw new UnsupportedMarketplacePlanYearError();
}

/** The SBM record for this year, or undefined for a federal-platform state. */
export function stateBasedMarketplace(state?: string, year: number = DEFAULT_MARKETPLACE_PLAN_YEAR): StateMarketplace | undefined {
  assertMarketplacePlanYear(year);
  const code = state?.toUpperCase();
  return code ? MARKETPLACE_CATALOG.years[String(year)].marketplaces[code] : undefined;
}

/** Thrown when a request targets an SBM state the federal API can't serve — a clear redirect, not an outage. */
export class StateNotSupportedError extends Error {
  constructor(public readonly marketplace: StateMarketplace) {
    super(`${marketplace.state} uses its own marketplace (${marketplace.name})`);
    this.name = "StateNotSupportedError";
  }
}
