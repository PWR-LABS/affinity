/**
 * M2 true-cost types — rank plans on expected annual cost, never sticker premium.
 *
 * The engine combines four parts: (1) subsidy (PTC) net of the household's expected contribution,
 * (2) cost-sharing reductions (CSR, Silver only), (3) expected medical out-of-pocket from a utilization
 * model, and (4) expected drug out-of-pocket by formulary tier. Every result carries `notes` recording
 * the assumptions made — the doctrine's "honest limits visible" applied to money.
 */
export type MetalLevel = "Bronze" | "Silver" | "Gold" | "Platinum" | "Catastrophic";

/** Expected annual utilization. Deliberately simple + explicit; refined per-household later. */
export interface UtilizationProfile {
  /** Expected annual allowed (pre-insurance) medical spend, EXCLUDING the listed drugs. */
  expectedAllowedMedicalUsd: number;
}

/** The household's drugs with resolved formulary tiers (from M1) + tier copay assumptions. */
export interface DrugCostInput {
  /** Assumed monthly copay per formulary tier, e.g. { GENERIC: 10, PREFERRED_BRAND: 45 }. */
  tierMonthlyCopayUsd: Record<string, number>;
  /** Copay assumed when a drug's tier is unknown (honest fallback, recorded in notes). */
  unknownTierMonthlyCopayUsd: number;
  meds: Array<{ rxcui: string; tier?: string; monthlyFills?: number }>;
}

/** The cost-sharing a plan exposes (from the Plan model / Marketplace API). */
export interface PlanCostInputs {
  planId: string;
  planLabel?: string;
  metalLevel: MetalLevel;
  premiumUsdMonthly: number;
  deductibleUsd: number;
  oopMaxUsd: number;
  /** Member coinsurance share after deductible (0..1). */
  coinsuranceRate: number;
}

export interface SubsidyResult {
  fplPercent: number;
  /** Expected contribution as a percent of income (the ACA applicable percentage). */
  applicablePercent: number;
  expectedAnnualContributionUsd: number;
  benchmarkAnnualPremiumUsd: number;
  /** Advance premium tax credit for the year (PTC). */
  aptcAnnualUsd: number;
  eligible: boolean;
  /** CSR variant the household qualifies for when buying Silver ("94" | "87" | "73"), else undefined. */
  csrVariant?: string;
  csrAv?: number;
  source: string;
  notes: string[];
}

export interface TrueCostResult {
  planId: string;
  planLabel?: string;
  metalLevel: MetalLevel;
  grossAnnualPremiumUsd: number;
  aptcAppliedUsd: number;
  netAnnualPremiumUsd: number;
  expectedMedicalOOPUsd: number;
  expectedDrugOOPUsd: number;
  /** netAnnualPremium + (medical + drug OOP, capped at the effective OOP max). */
  trueAnnualCostUsd: number;
  /** True when CSR was applied (Silver + eligible). */
  csrApplied: boolean;
  notes: string[];
}
