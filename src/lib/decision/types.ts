/**
 * M4 decision layer — the single object the web UI renders.
 *
 * Assembles M1 matching + M2 true-cost + M3 verification into a per-plan `PlanDecision`, and ranks the
 * board by **true annual cost** (the doctrine ranking). The UI is a thin renderer over this; all the
 * reasoning stays in the tested engines. Works identically on fixtures or live data.
 */
import type { TrueCostResult } from "@/lib/cost/types";
import type { PlanMatch } from "@/lib/matching/types";
import type { VerificationReport } from "@/lib/verify/types";

export interface PlanDecision {
  planId: string;
  label: string;
  metalLevel: string;
  /** Expected annual cost (premium − subsidy + OOP + drugs). The rank key. */
  trueCost: TrueCostResult;
  /** Per-plan doctor/med coverage (statuses + summary). */
  match: PlanMatch;
  /** Graded network-confidence + freshness + confirm-checklist. */
  verify: VerificationReport;
}

export interface DecisionProfileSummary {
  zip?: string;
  householdIncomeUsd?: number;
  householdSize?: number;
  doctorCount: number;
  medicationCount: number;
}

export interface DecisionBoard {
  profile: DecisionProfileSummary;
  /** Honest subsidy line (APTC estimate + CSR), with the verify caveat. */
  subsidyHeadline: string;
  /** Plans ranked by true annual cost, cheapest first. */
  plans: PlanDecision[];
  asOf: string;
  /** false = demo/fixture data (no API key); true = live Marketplace + issuer MRF. */
  isLive: boolean;
  notes: string[];
}
