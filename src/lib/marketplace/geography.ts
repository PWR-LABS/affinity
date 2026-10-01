import type { MarketplaceCounty } from "./types";

export type CountyResolution =
  | { status: "not_found" }
  | { status: "state_mismatch" }
  | { status: "ambiguous" }
  | { status: "unique"; county: MarketplaceCounty };

/** Never infer a Marketplace rating area from the API's array order. */
export function resolveCounty(counties: readonly MarketplaceCounty[], requestedState?: string): CountyResolution {
  if (counties.length === 0) return { status: "not_found" };
  const matching = requestedState
    ? counties.filter((county) => county.state === requestedState.toUpperCase())
    : counties;
  if (matching.length === 0) return { status: "state_mismatch" };
  const unique = new Map(matching.map((county) => [`${county.state}:${county.fips}`, county]));
  if (unique.size !== 1) return { status: "ambiguous" };
  return { status: "unique", county: [...unique.values()][0] };
}
