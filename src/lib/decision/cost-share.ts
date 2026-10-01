import type { MarketplaceCostShare } from "@/lib/marketplace/types";

/**
 * A plan-board number must be explicitly per-person, in-network, and combined
 * medical+drug. When the source offers conflicting CSR/tier amounts, do not
 * silently choose the first variant; keep the field unknown until resolved.
 */
export function pickVerifiedCostShare(items?: MarketplaceCostShare[]): number | undefined {
  if (!Array.isArray(items)) return undefined;
  const amounts = items
    .filter((item) => item && typeof item === "object" && typeof item.network_tier === "string" && item.network_tier.trim().toLowerCase() === "in-network")
    .filter((item) => typeof item.family_cost === "string" && item.family_cost.trim().toLowerCase() === "individual")
    .filter((item) => typeof item.type === "string" && /combined|medical and drug/i.test(item.type))
    .map((item) => item.amount)
    .filter((amount): amount is number => typeof amount === "number" && Number.isFinite(amount) && amount >= 0);
  const unique = [...new Set(amounts)];
  return unique.length === 1 ? unique[0] : undefined;
}
