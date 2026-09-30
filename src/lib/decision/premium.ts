/**
 * The live Marketplace board can annualize a quoted net premium, but it cannot infer total
 * annual spending from premium, deductible, and OOP maximum alone.
 */
export function premiumAmounts(
  grossMonthly: number | undefined,
  aptcMonthly: number,
  metalLevel?: string,
): { grossMonthly?: number; netMonthly?: number; netAnnual?: number } {
  if (grossMonthly === undefined || !Number.isFinite(grossMonthly) || grossMonthly < 0) return {};
  const credit = Number.isFinite(aptcMonthly) && aptcMonthly > 0 ? aptcMonthly : 0;
  const aptcEligible = !/catastrophic/i.test(metalLevel ?? "");
  const net = aptcEligible ? Math.max(0, grossMonthly - credit) : grossMonthly;
  const netMonthly = Math.round(net);
  return {
    grossMonthly: Math.round(grossMonthly),
    netMonthly,
    netAnnual: netMonthly * 12,
  };
}
