/**
 * M1 matching types — a household's doctors + meds answered against each plan.
 *
 * The matching engine lifts M0's single-pair reconciliation (one provider|drug vs one plan) to a whole
 * Profile across many plans, and rolls each plan up into a coverage summary + a plan-level
 * network-confidence signal + a "what to double-check" confirm list. It ranks on coverage
 * completeness (weighted by confidence) — NOT on cost; the true-cost ranking is M2/M4.
 */
import type { ReconciledClaim } from "@/lib/reconcile";

/**
 * Per-subject coverage status, derived from the reconciliation verdict. The `_unverified` variants
 * mean only ONE source spoke (the other was silent) — honest about thinner evidence, never upgraded
 * to a clean yes/no.
 */
export type CoverageStatus =
  | "covered" //              both sources agree: in-network / on-formulary
  | "covered_unverified" //   one source says covered, the other is silent
  | "not_covered" //          both sources agree: not covered
  | "not_covered_unverified" // one source says not covered, the other is silent
  | "disputed" //             sources conflict — the network-truth signal
  | "unknown"; //             neither source has an answer

export interface MatchedSubject {
  kind: "PROVIDER" | "DRUG";
  /** NPI (provider) or RxCUI (drug). */
  subjectKey: string;
  label?: string;
  status: CoverageStatus;
  /** Formulary tier when a drug is (un)covered and a tier is known. */
  formularyTier?: string;
  /** The full reconciliation (both source answers + verdict + reconciled confidence). */
  reconciled: ReconciledClaim;
  /** True unless this is a high-confidence agreement — i.e. the user should confirm before relying. */
  needsConfirmation: boolean;
}

export interface PlanMatchSummary {
  doctorsTotal: number;
  doctorsCovered: number; //     covered + covered_unverified
  doctorsDisputed: number;
  doctorsNotCovered: number; //  not_covered + not_covered_unverified
  doctorsUnknown: number;

  drugsTotal: number;
  drugsOnFormulary: number; //   covered + covered_unverified
  drugsDisputed: number;
  drugsNotCovered: number;
  drugsUnknown: number;

  /** 0..1 — mean reconciled confidence across all subjects: the plan-level network-confidence. */
  networkConfidence: number;
  /** 0..1 — coverage completeness weighted by confidence. The M1 ranking key (cost ranking is M2/M4). */
  matchScore: number;
  /** Subjects to confirm with the provider's office before trusting (conflicts, one-sided, unknown). */
  confirmList: MatchedSubject[];
}

export interface PlanMatch {
  planId: string;
  planLabel?: string;
  providers: MatchedSubject[];
  drugs: MatchedSubject[];
  summary: PlanMatchSummary;
}

/** The household side of the match: who they see, what they take. */
export interface MatchProfileInput {
  doctors: Array<{ npi: string; label?: string }>;
  medications: Array<{ rxcui: string; label?: string }>;
}
