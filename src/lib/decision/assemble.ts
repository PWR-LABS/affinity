/**
 * Assemble a {@link DecisionBoard} from a profile + plans, reusing the tested engines end to end.
 *
 * Per plan: match (M1) → resolve each drug's formulary tier from the match → true cost (M2) → verify
 * (M3). The board is then ranked by true annual cost. The subsidy/APTC is computed once (it is
 * benchmark-driven and identical across plans; only CSR varies by metal). Pure + deterministic.
 */
import { estimateHouseholdPlanCost, type Household } from "@/lib/cost/engine";
import { computeSubsidy } from "@/lib/cost/subsidy";
import type { DrugCostInput, MetalLevel, PlanCostInputs, UtilizationProfile } from "@/lib/cost/types";
import { matchPlan, type PlanCoverageInputs } from "@/lib/matching/engine";
import type { MatchProfileInput } from "@/lib/matching/types";
import type { MrfDataset } from "@/lib/mrf/dataset";
import { verifyPlan } from "@/lib/verify/report";

import type { DecisionBoard, PlanDecision } from "./types";

/** A plan's coverage flags (for matching) + its cost-sharing (for the true-cost engine). */
export interface DecisionPlanInput extends PlanCoverageInputs {
  metalLevel: MetalLevel;
  premiumUsdMonthly: number;
  deductibleUsd: number;
  oopMaxUsd: number;
  coinsuranceRate: number;
}

/** Household drug assumptions: tier copays + expected monthly fills per drug (tier is resolved per plan). */
export interface DecisionDrugAssumptions {
  tierMonthlyCopayUsd: Record<string, number>;
  unknownTierMonthlyCopayUsd: number;
  fillsByRxcui?: Record<string, number>;
}

export interface DecisionInputs {
  profile: MatchProfileInput;
  profileMeta: { zip?: string; householdIncomeUsd: number; householdSize: number };
  benchmarkMonthlyPremiumUsd: number;
  utilization: UtilizationProfile;
  drug: DecisionDrugAssumptions;
  plans: DecisionPlanInput[];
  dataset: MrfDataset;
  fetchedAt: string;
  asOf: string;
  isLive: boolean;
}

export function assembleDecision(input: DecisionInputs): DecisionBoard {
  const household: Household = {
    incomeUsd: input.profileMeta.householdIncomeUsd,
    householdSize: input.profileMeta.householdSize,
    benchmarkMonthlyPremiumUsd: input.benchmarkMonthlyPremiumUsd,
  };

  const decisions: PlanDecision[] = input.plans.map((plan) => {
    const match = matchPlan(input.profile, plan, input.dataset, input.fetchedAt);

    // Build the per-plan drug cost input, pulling each drug's formulary tier from the match.
    const drug: DrugCostInput = {
      tierMonthlyCopayUsd: input.drug.tierMonthlyCopayUsd,
      unknownTierMonthlyCopayUsd: input.drug.unknownTierMonthlyCopayUsd,
      meds: input.profile.medications.map((m) => ({
        rxcui: m.rxcui,
        tier: match.drugs.find((d) => d.subjectKey === m.rxcui)?.formularyTier,
        monthlyFills: input.drug.fillsByRxcui?.[m.rxcui] ?? 1,
      })),
    };

    const costInputs: PlanCostInputs = {
      planId: plan.planId,
      planLabel: plan.planLabel,
      metalLevel: plan.metalLevel,
      premiumUsdMonthly: plan.premiumUsdMonthly,
      deductibleUsd: plan.deductibleUsd,
      oopMaxUsd: plan.oopMaxUsd,
      coinsuranceRate: plan.coinsuranceRate,
    };
    const trueCost = estimateHouseholdPlanCost(costInputs, household, input.utilization, drug);
    const verify = verifyPlan(match, input.asOf);

    return {
      planId: plan.planId,
      label: plan.planLabel ?? plan.planId,
      metalLevel: plan.metalLevel,
      trueCost,
      match,
      verify,
    };
  });

  decisions.sort((a, b) => {
    if (a.trueCost.trueAnnualCostUsd !== b.trueCost.trueAnnualCostUsd)
      return a.trueCost.trueAnnualCostUsd - b.trueCost.trueAnnualCostUsd;
    return a.planId.localeCompare(b.planId);
  });

  // Subsidy is benchmark-driven (same APTC across plans); compute once on Silver for the CSR line.
  const subsidy = computeSubsidy({
    incomeUsd: household.incomeUsd,
    householdSize: household.householdSize,
    benchmarkMonthlyPremiumUsd: input.benchmarkMonthlyPremiumUsd,
    metalLevel: "Silver",
  });
  const subsidyHeadline = subsidy.eligible
    ? `Estimated subsidy ~$${Math.round(subsidy.aptcAnnualUsd).toLocaleString()}/yr (APTC)` +
      (subsidy.csrVariant ? ` + Silver CSR ${subsidy.csrVariant}` : "") +
      " — an estimate; confirm on the official Marketplace."
    : "No premium subsidy at this income — confirm eligibility on the official Marketplace.";

  return {
    profile: {
      zip: input.profileMeta.zip,
      householdIncomeUsd: input.profileMeta.householdIncomeUsd,
      householdSize: input.profileMeta.householdSize,
      doctorCount: input.profile.doctors.length,
      medicationCount: input.profile.medications.length,
    },
    subsidyHeadline,
    plans: decisions,
    asOf: input.asOf,
    isLive: input.isLive,
    notes: input.isLive
      ? []
      : ["Set MARKETPLACE_API_KEY + AFFINITY_EVAL_* to rank your real plans for your rating area."],
  };
}
