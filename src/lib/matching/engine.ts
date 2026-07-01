/**
 * M1 matching engine — pure, deterministic, source-agnostic.
 *
 * `matchPlan` answers a whole Profile (doctors + meds) against one plan by reconciling each subject's
 * Marketplace-API answer with the issuer MRF (reusing the M0 reconciliation core), classifying a
 * coverage status, and rolling up a summary + plan-level network-confidence + confirm list.
 * `matchProfile` runs it across many plans and ranks them by coverage completeness (weighted by
 * confidence). Cost is NOT considered here — the true-cost ranking is M2/M4.
 */
import {
  drugCoverageToAnswer,
  providerCoverageToAnswer,
} from "@/lib/marketplace/client";
import type {
  MarketplaceDrugCoverage,
  MarketplaceProviderCoverage,
} from "@/lib/marketplace/types";
import type { MrfDataset } from "@/lib/mrf/dataset";
import { reconcileClaim, type ReconciledClaim } from "@/lib/reconcile";

import type {
  CoverageStatus,
  MatchedSubject,
  MatchProfileInput,
  PlanMatch,
  PlanMatchSummary,
} from "./types";

/** Per-plan coverage inputs from the Marketplace API side (one map each, keyed by NPI / RxCUI). */
export interface PlanCoverageInputs {
  planId: string;
  planLabel?: string;
  apiProviders: Map<string, MarketplaceProviderCoverage>;
  apiDrugs: Map<string, MarketplaceDrugCoverage>;
}

/** Map a reconciliation verdict + values to a coverage status. */
export function statusFor(r: ReconciledClaim): CoverageStatus {
  switch (r.verdict) {
    case "AGREE":
      return r.api.value === "yes" ? "covered" : "not_covered";
    case "CONFLICT":
      return "disputed";
    case "API_ONLY":
      return r.api.value === "yes" ? "covered_unverified" : "not_covered_unverified";
    case "MRF_ONLY":
      return r.mrf.value === "yes" ? "covered_unverified" : "not_covered_unverified";
    case "BOTH_UNKNOWN":
      return "unknown";
  }
}

/** Coverage you can rely on (clean agreement, high confidence) needs no confirmation; everything else does. */
function needsConfirmation(r: ReconciledClaim): boolean {
  return !(r.verdict === "AGREE" && r.reconciledConfidence >= 0.8);
}

/** Score contribution per subject — rewards confident coverage, partial credit for one-sided/disputed. */
function scoreContribution(status: CoverageStatus, confidence: number): number {
  switch (status) {
    case "covered":
      return confidence;
    case "covered_unverified":
      return 0.6 * confidence;
    case "disputed":
      return 0.1; // the doctor *might* be in-network — small credit, but flagged to confirm
    default:
      return 0; // not_covered(_unverified) and unknown contribute nothing
  }
}

function tierFor(r: ReconciledClaim): string | undefined {
  return r.api.formularyTier ?? r.mrf.formularyTier;
}

function matchSubject(
  kind: "PROVIDER" | "DRUG",
  subjectKey: string,
  label: string | undefined,
  reconciled: ReconciledClaim,
): MatchedSubject {
  return {
    kind,
    subjectKey,
    label,
    status: statusFor(reconciled),
    formularyTier: kind === "DRUG" ? tierFor(reconciled) : undefined,
    reconciled,
    needsConfirmation: needsConfirmation(reconciled),
  };
}

/** Match a whole Profile against one plan. */
export function matchPlan(
  profile: MatchProfileInput,
  inputs: PlanCoverageInputs,
  dataset: MrfDataset,
  fetchedAt: string,
): PlanMatch {
  const providers: MatchedSubject[] = profile.doctors.map((d) => {
    const raw = inputs.apiProviders.get(d.npi) ?? { npi: d.npi }; // absent → unknown (silence ≠ denial)
    const api = providerCoverageToAnswer(raw, fetchedAt);
    const mrf = dataset.providerAnswer(d.npi, inputs.planId);
    const reconciled = reconcileClaim({ kind: "PROVIDER", subjectKey: d.npi, planId: inputs.planId, api, mrf });
    return matchSubject("PROVIDER", d.npi, d.label ?? api.subjectLabel ?? mrf.subjectLabel, reconciled);
  });

  const drugs: MatchedSubject[] = profile.medications.map((m) => {
    const raw = inputs.apiDrugs.get(m.rxcui) ?? { rxcui: m.rxcui };
    const api = drugCoverageToAnswer(raw, fetchedAt);
    const mrf = dataset.drugAnswer(m.rxcui, inputs.planId);
    const reconciled = reconcileClaim({ kind: "DRUG", subjectKey: m.rxcui, planId: inputs.planId, api, mrf });
    return matchSubject("DRUG", m.rxcui, m.label ?? api.subjectLabel ?? mrf.subjectLabel, reconciled);
  });

  return {
    planId: inputs.planId,
    planLabel: inputs.planLabel,
    providers,
    drugs,
    summary: summarize(providers, drugs),
  };
}

function summarize(providers: MatchedSubject[], drugs: MatchedSubject[]): PlanMatchSummary {
  const all = [...providers, ...drugs];
  const countDoc = (pred: (s: MatchedSubject) => boolean) => providers.filter(pred).length;
  const countDrug = (pred: (s: MatchedSubject) => boolean) => drugs.filter(pred).length;

  const covered = (s: MatchedSubject) => s.status === "covered" || s.status === "covered_unverified";
  const notCovered = (s: MatchedSubject) =>
    s.status === "not_covered" || s.status === "not_covered_unverified";
  const disputed = (s: MatchedSubject) => s.status === "disputed";
  const unknown = (s: MatchedSubject) => s.status === "unknown";

  const networkConfidence =
    all.length === 0
      ? 0
      : round2(all.reduce((sum, s) => sum + s.reconciled.reconciledConfidence, 0) / all.length);

  const matchScore =
    all.length === 0
      ? 0
      : round2(
          all.reduce((sum, s) => sum + scoreContribution(s.status, s.reconciled.reconciledConfidence), 0) /
            all.length,
        );

  return {
    doctorsTotal: providers.length,
    doctorsCovered: countDoc(covered),
    doctorsDisputed: countDoc(disputed),
    doctorsNotCovered: countDoc(notCovered),
    doctorsUnknown: countDoc(unknown),
    drugsTotal: drugs.length,
    drugsOnFormulary: countDrug(covered),
    drugsDisputed: countDrug(disputed),
    drugsNotCovered: countDrug(notCovered),
    drugsUnknown: countDrug(unknown),
    networkConfidence,
    matchScore,
    confirmList: all.filter((s) => s.needsConfirmation),
  };
}

/**
 * Match a Profile against many plans and rank them. Ranking is by matchScore (coverage completeness,
 * confidence-weighted), tie-broken by networkConfidence then planId for stable, deterministic order.
 * NOTE: this is a *coverage* ranking, not a cost ranking — true annual cost arrives in M2/M4.
 */
export function matchProfile(
  profile: MatchProfileInput,
  plans: PlanCoverageInputs[],
  dataset: MrfDataset,
  fetchedAt: string,
): PlanMatch[] {
  const matches = plans.map((p) => matchPlan(profile, p, dataset, fetchedAt));
  return matches.sort((a, b) => {
    if (b.summary.matchScore !== a.summary.matchScore) return b.summary.matchScore - a.summary.matchScore;
    if (b.summary.networkConfidence !== a.summary.networkConfidence)
      return b.summary.networkConfidence - a.summary.networkConfidence;
    return a.planId.localeCompare(b.planId);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
