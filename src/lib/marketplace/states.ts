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
export interface StateMarketplace {
  /** Full state name, for prose. */
  state: string;
  /** The marketplace's brand name. */
  name: string;
  /** Bare domain (no scheme), so the UI can render it as text or a link. */
  url: string;
}

export const SUPPORTED_MARKETPLACE_PLAN_YEARS = [2026, 2027] as const;
export type MarketplacePlanYear = (typeof SUPPORTED_MARKETPLACE_PLAN_YEARS)[number];
/** Deliberately explicit; never roll the quote year forward from the device clock. */
export const DEFAULT_MARKETPLACE_PLAN_YEAR: MarketplacePlanYear = 2026;
export const MARKETPLACE_PLAN_YEAR_ERROR = "Choose 2026 or 2027 coverage.";

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

const SBM: Record<string, StateMarketplace> = {
  CA: { state: "California", name: "Covered California", url: "coveredca.com" },
  CO: { state: "Colorado", name: "Connect for Health Colorado", url: "connectforhealthco.com" },
  CT: { state: "Connecticut", name: "Access Health CT", url: "accesshealthct.com" },
  DC: { state: "Washington, D.C.", name: "DC Health Link", url: "dchealthlink.com" },
  GA: { state: "Georgia", name: "Georgia Access", url: "georgiaaccess.gov" },
  ID: { state: "Idaho", name: "Your Health Idaho", url: "yourhealthidaho.org" },
  IL: { state: "Illinois", name: "Get Covered Illinois", url: "getcovered.illinois.gov" },
  KY: { state: "Kentucky", name: "kynect", url: "kynect.ky.gov" },
  ME: { state: "Maine", name: "CoverME.gov", url: "coverme.gov" },
  MD: { state: "Maryland", name: "Maryland Health Connection", url: "marylandhealthconnection.gov" },
  MA: { state: "Massachusetts", name: "Massachusetts Health Connector", url: "mahealthconnector.org" },
  MN: { state: "Minnesota", name: "MNsure", url: "mnsure.org" },
  NV: { state: "Nevada", name: "Nevada Health Link", url: "nevadahealthlink.com" },
  NJ: { state: "New Jersey", name: "Get Covered New Jersey", url: "getcovered.nj.gov" },
  NM: { state: "New Mexico", name: "beWellnm", url: "bewellnm.com" },
  NY: { state: "New York", name: "NY State of Health", url: "nystateofhealth.ny.gov" },
  PA: { state: "Pennsylvania", name: "Pennie", url: "pennie.com" },
  RI: { state: "Rhode Island", name: "HealthSource RI", url: "healthsourceri.com" },
  VT: { state: "Vermont", name: "Vermont Health Connect", url: "portal.healthconnect.vermont.gov" },
  VA: { state: "Virginia", name: "Virginia's Insurance Marketplace", url: "marketplace.virginia.gov" },
  WA: { state: "Washington", name: "Washington Healthplanfinder", url: "wahealthplanfinder.org" },
};

/** The SBM record for this year, or undefined for a federal-platform state. */
export function stateBasedMarketplace(state?: string, year: number = DEFAULT_MARKETPLACE_PLAN_YEAR): StateMarketplace | undefined {
  assertMarketplacePlanYear(year);
  const code = state?.toUpperCase();
  if (year === 2027 && code === "OR") return { state: "Oregon", name: "Explore Health", url: "explorehealthor.gov" };
  return code ? SBM[code] : undefined;
}

/** Thrown when a request targets an SBM state the federal API can't serve — a clear redirect, not an outage. */
export class StateNotSupportedError extends Error {
  constructor(public readonly marketplace: StateMarketplace) {
    super(`${marketplace.state} uses its own marketplace (${marketplace.name})`);
    this.name = "StateNotSupportedError";
  }
}
