/**
 * M2 true-cost engine — net premium + expected medical OOP + expected drug OOP, capped at the OOP max.
 *
 * Pure and deterministic. CSR (Silver only) lowers effective cost-sharing by the actuarial-value ratio;
 * the utilization model is a transparent deductible→coinsurance→cap curve; drug OOP is tier copays × fills.
 * Every approximation is recorded in `notes`. The output orders plans by `trueAnnualCostUsd` — the
 * doctrine's ranking key. (Network confidence from M1 is a separate axis the M4 decision UI combines.)
 */
import { POLICY_2026, type PolicyParams } from "./policy";
import { computeSubsidy } from "./subsidy";
import type {
  DrugCostInput,
  PlanCostInputs,
  SubsidyResult,
  TrueCostResult,
  UtilizationProfile,
} from "./types";

export interface Household {
  incomeUsd: number;
  householdSize: number;
  /** Benchmark (SLCSP) monthly premium for the rating area — drives the PTC. */
  benchmarkMonthlyPremiumUsd: number;
}

/** CSR scales effective cost-sharing by (1−AV)/(1−baseAV); 1.0 when no CSR applies. */
function csrFactor(csrAv: number | undefined, params: PolicyParams): number {
  if (csrAv === undefined) return 1;
  return (1 - csrAv) / (1 - params.silverBaseAv);
}

function estimateDrugOOP(drug: DrugCostInput): { usd: number; usedUnknown: boolean } {
  let usd = 0;
  let usedUnknown = false;
  for (const m of drug.meds) {
    const fills = m.monthlyFills ?? 1;
    const copay = m.tier ? drug.tierMonthlyCopayUsd[m.tier] : undefined;
    if (copay === undefined) {
      usedUnknown = usedUnknown || true;
      usd += drug.unknownTierMonthlyCopayUsd * fills * 12;
    } else {
      usd += copay * fills * 12;
    }
  }
  return { usd: round2(usd), usedUnknown };
}

/** Compute one plan's expected annual true cost for a household, given a precomputed subsidy. */
export function trueAnnualCost(
  plan: PlanCostInputs,
  subsidy: SubsidyResult,
  utilization: UtilizationProfile,
  drug: DrugCostInput,
  params: PolicyParams = POLICY_2026,
): TrueCostResult {
  const notes: string[] = [];
  const gross = round2(plan.premiumUsdMonthly * 12);
  // PTC applies to the chosen plan but cannot exceed its premium.
  const aptcApplied = Math.min(gross, subsidy.aptcAnnualUsd);
  const net = round2(Math.max(0, gross - aptcApplied));

  const csrApplies = plan.metalLevel === "Silver" && subsidy.csrAv !== undefined;
  const factor = csrApplies ? csrFactor(subsidy.csrAv, params) : 1;
  if (csrApplies) {
    notes.push(
      `CSR variant ${subsidy.csrVariant} applied (Silver): effective cost-sharing scaled ×${round2(factor)} (approximation — the live API returns exact CSR-variant cost-sharing).`,
    );
  }
  const effDeductible = round2(plan.deductibleUsd * factor);
  const effOopMax = round2(plan.oopMaxUsd * factor);

  const medicalOOP = round2(
    effDeductible + plan.coinsuranceRate * Math.max(0, utilization.expectedAllowedMedicalUsd - effDeductible),
  );
  const drugRes = estimateDrugOOP(drug);
  if (drugRes.usedUnknown) {
    notes.push(
      `One or more drugs had an unknown formulary tier; used the unknown-tier copay assumption ($${drug.unknownTierMonthlyCopayUsd}/mo).`,
    );
  }

  const cappedOOP = Math.min(effOopMax, round2(medicalOOP + drugRes.usd));
  if (medicalOOP + drugRes.usd > effOopMax) {
    notes.push(`Expected OOP hit the out-of-pocket maximum ($${effOopMax}); member spend is capped there.`);
  }

  const trueCost = round2(net + cappedOOP);

  return {
    planId: plan.planId,
    planLabel: plan.planLabel,
    metalLevel: plan.metalLevel,
    grossAnnualPremiumUsd: gross,
    aptcAppliedUsd: round2(aptcApplied),
    netAnnualPremiumUsd: net,
    expectedMedicalOOPUsd: medicalOOP,
    expectedDrugOOPUsd: drugRes.usd,
    trueAnnualCostUsd: trueCost,
    csrApplied: csrApplies,
    notes: [...subsidy.notes, ...notes],
  };
}

/** Convenience: compute subsidy (from the household + plan metal) then the plan's true cost. */
export function estimateHouseholdPlanCost(
  plan: PlanCostInputs,
  household: Household,
  utilization: UtilizationProfile,
  drug: DrugCostInput,
  params: PolicyParams = POLICY_2026,
): TrueCostResult {
  const subsidy = computeSubsidy({
    incomeUsd: household.incomeUsd,
    householdSize: household.householdSize,
    benchmarkMonthlyPremiumUsd: household.benchmarkMonthlyPremiumUsd,
    metalLevel: plan.metalLevel,
    params,
  });
  return trueAnnualCost(plan, subsidy, utilization, drug, params);
}

/** Rank true-cost results ascending (cheapest expected annual cost first). Stable + deterministic. */
export function rankByTrueCost(results: TrueCostResult[]): TrueCostResult[] {
  return [...results].sort((a, b) => {
    if (a.trueAnnualCostUsd !== b.trueAnnualCostUsd) return a.trueAnnualCostUsd - b.trueAnnualCostUsd;
    return a.planId.localeCompare(b.planId);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
