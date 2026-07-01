/**
 * State-Based Marketplaces (SBMs) — states that run their OWN ACA exchange on their OWN platform,
 * instead of the federal HealthCare.gov platform. The Marketplace API (marketplace.api.healthcare.gov)
 * only serves the federally-facilitated states, so for an SBM state we can't pull live plans or the
 * subsidy estimate. Rather than fail with a misleading "couldn't reach the Marketplace, try again," we
 * detect the state up front (from the ZIP's county) and send people to their own marketplace — where
 * their real plans and subsidies live.
 *
 * Scope note: this list is the full-platform SBMs. "SBM-FP" states (state-branded but running ON the
 * federal platform, e.g. Oregon) ARE served by the API, so they're intentionally NOT here. Source: CMS /
 * KFF SBM list, 2026 plan year. Conservative by design — a state we omit just falls back to the generic
 * path (no worse than before); a state we wrongly include would be sent to a real, working exchange.
 */
export interface StateMarketplace {
  /** Full state name, for prose. */
  state: string;
  /** The marketplace's brand name. */
  name: string;
  /** Bare domain (no scheme), so the UI can render it as text or a link. */
  url: string;
}

const SBM: Record<string, StateMarketplace> = {
  CA: { state: "California", name: "Covered California", url: "coveredca.com" },
  CO: { state: "Colorado", name: "Connect for Health Colorado", url: "connectforhealthco.com" },
  CT: { state: "Connecticut", name: "Access Health CT", url: "accesshealthct.com" },
  DC: { state: "Washington, D.C.", name: "DC Health Link", url: "dchealthlink.com" },
  GA: { state: "Georgia", name: "Georgia Access", url: "georgiaaccess.gov" },
  ID: { state: "Idaho", name: "Your Health Idaho", url: "yourhealthidaho.org" },
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

/** The SBM record for a two-letter state code, or undefined if the state is on the federal platform. */
export function stateBasedMarketplace(state?: string): StateMarketplace | undefined {
  return state ? SBM[state.toUpperCase()] : undefined;
}

/** Thrown when a request targets an SBM state the federal API can't serve — a clear redirect, not an outage. */
export class StateNotSupportedError extends Error {
  constructor(public readonly marketplace: StateMarketplace) {
    super(`${marketplace.state} uses its own marketplace (${marketplace.name})`);
    this.name = "StateNotSupportedError";
  }
}
