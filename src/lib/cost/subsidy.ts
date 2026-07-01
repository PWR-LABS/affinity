/**
 * Premium tax credit (PTC) + CSR eligibility — the KFF-validated subsidy math.
 *
 * Implements the §36B formula KFF's calculator uses: PTC = benchmark (SLCSP) premium − the household's
 * expected contribution (income × applicable percentage), floored at 0, gated by the FPL eligibility
 * window (Medicaid floor below, the 2026 cliff above). In live mode the Marketplace API's eligibility
 * estimate is authoritative and should override this; here it is the deterministic, testable structure.
 */
import {
  applicablePercent,
  csrFor,
  fplPercent,
  POLICY_2026,
  type PolicyParams,
} from "./policy";
import type { MetalLevel, SubsidyResult } from "./types";

export interface SubsidyInput {
  incomeUsd: number;
  householdSize: number;
  /** Second-lowest-cost Silver plan (benchmark) monthly premium for this household/area. */
  benchmarkMonthlyPremiumUsd: number;
  /** Metal level being priced — CSR only attaches to Silver. */
  metalLevel: MetalLevel;
  params?: PolicyParams;
}

export function computeSubsidy(input: SubsidyInput): SubsidyResult {
  const p = input.params ?? POLICY_2026;
  const notes: string[] = [];
  if (p.verify) {
    notes.push(
      `Subsidy uses placeholder policy constants (${p.source}); verify against the live Marketplace API APTC before relying on the dollar figure.`,
    );
  }

  const fplPct = fplPercent(input.incomeUsd, input.householdSize, p);
  const benchmarkAnnual = round2(input.benchmarkMonthlyPremiumUsd * 12);

  // Eligibility window: Medicaid floor below, cliff above (when set).
  const belowFloor = fplPct < p.subsidyFloorFplPct;
  const aboveCeiling = p.subsidyCeilingFplPct !== null && fplPct > p.subsidyCeilingFplPct;
  const eligible = !belowFloor && !aboveCeiling;

  if (belowFloor) notes.push(`FPL ${round1(fplPct)}% is below ${p.subsidyFloorFplPct}% — likely Medicaid-eligible, no PTC.`);
  if (aboveCeiling)
    notes.push(`FPL ${round1(fplPct)}% exceeds the ${p.subsidyCeilingFplPct}% cliff — no PTC for ${p.year}.`);

  const appPct = applicablePercent(fplPct, p);
  const expectedContribution = eligible ? round2(input.incomeUsd * (appPct / 100)) : 0;
  const aptcAnnual = eligible ? Math.max(0, round2(benchmarkAnnual - expectedContribution)) : 0;

  const csr = eligible ? csrFor(fplPct, input.metalLevel, p) : undefined;

  return {
    fplPercent: round1(fplPct),
    applicablePercent: round2(appPct),
    expectedAnnualContributionUsd: expectedContribution,
    benchmarkAnnualPremiumUsd: benchmarkAnnual,
    aptcAnnualUsd: aptcAnnual,
    eligible,
    csrVariant: csr?.variant,
    csrAv: csr?.av,
    source: p.source,
    notes,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
