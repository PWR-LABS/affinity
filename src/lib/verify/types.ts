/**
 * M3 network-truth / verification types.
 *
 * M0 reconciles a single (subject, plan) pair; M1 rolls that into per-plan coverage + a raw confidence
 * mean. M3 turns it into the thing a person can act on: a graded, freshness-aware **network-confidence
 * report** per plan plus a concrete **confirm-checklist** ("call these offices, ask this"). This is the
 * surface the M4 decision UI renders and the operational form of the core promise — never present
 * coverage as ground truth; show how much to trust it and what to double-check.
 */
export type ConfidenceGrade = "A" | "B" | "C" | "D" | "F";

/** Why a subject landed on the confirm-checklist (highest-priority reason wins). */
export type ChecklistReason = "conflict" | "unknown" | "unverified" | "low_confidence";

export interface ChecklistItem {
  kind: "PROVIDER" | "DRUG";
  /** NPI (provider) or RxCUI (drug). */
  subjectKey: string;
  label?: string;
  reason: ChecklistReason;
  /** Plain-language action the user should take before enrolling. */
  action: string;
}

export interface FreshnessSummary {
  /** Oldest issuer-reported source date across the plan's claims (ISO, date only). */
  oldestSourceDate?: string;
  /** Newest issuer-reported source date (ISO, date only). */
  newestSourceDate?: string;
  /** Claims whose source is older than the staleness threshold. */
  staleClaimCount: number;
  /** Claims that carried an issuer freshness date at all (denominator for staleness). */
  datedClaimCount: number;
}

export interface VerificationReport {
  planId: string;
  planLabel?: string;
  /** 0..1 network-confidence (mean reconciled confidence, penalized for stale data). */
  networkConfidenceScore: number;
  grade: ConfidenceGrade;
  totalClaims: number;
  agreeCount: number;
  conflictCount: number;
  /** One-sided answers (API or MRF silent). */
  unverifiedCount: number;
  unknownCount: number;
  freshness: FreshnessSummary;
  /** Subjects to confirm before enrolling — the actionable output. */
  checklist: ChecklistItem[];
  /** Honest one-line summary. Never asserts coverage as fact. */
  headline: string;
}
