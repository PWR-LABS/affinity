/**
 * Network-truth reconciliation — the [affinity.] moat, in its smallest honest form.
 *
 * Everyone can fetch coverage data; nobody makes it trustworthy. This module diffs the Marketplace
 * API's answer against the issuer's own machine-readable file for the same (provider|drug, plan) pair
 * and emits a verdict — AGREE / CONFLICT / API_ONLY / MRF_ONLY / BOTH_UNKNOWN — plus a reconciled
 * confidence. Agreement across two independent sources raises confidence; a conflict ("API says
 * in-network, the issuer's file says out") is surfaced, never silently resolved. That conflict count
 * is the first proof of the thesis and the seed of the per-plan network-confidence score (M3).
 */
import type { CoverageAnswer, SourceTag, Tristate } from "@/lib/provenance";

export type ReconcileVerdict = "AGREE" | "CONFLICT" | "API_ONLY" | "MRF_ONLY" | "BOTH_UNKNOWN";

export interface ReconciledClaim {
  kind: "PROVIDER" | "DRUG";
  /** NPI or RxCUI. */
  subjectKey: string;
  planId: string;
  verdict: ReconcileVerdict;
  api: CoverageAnswer;
  mrf: CoverageAnswer;
  /** Confidence after combining the two sources (0..1). */
  reconciledConfidence: number;
  agreesWith: SourceTag[];
  conflictsWith: SourceTag[];
}

export interface ReconcileSummary {
  total: number;
  agree: number;
  conflict: number;
  apiOnly: number;
  mrfOnly: number;
  bothUnknown: number;
  /** Of the pairs where BOTH sources gave a definite yes/no, the share that agreed (0..1, or null). */
  agreementRateAmongComparable: number | null;
  claims: ReconciledClaim[];
}

function classify(apiVal: Tristate, mrfVal: Tristate): ReconcileVerdict {
  const apiKnown = apiVal !== "unknown";
  const mrfKnown = mrfVal !== "unknown";
  if (!apiKnown && !mrfKnown) return "BOTH_UNKNOWN";
  if (apiKnown && !mrfKnown) return "API_ONLY";
  if (!apiKnown && mrfKnown) return "MRF_ONLY";
  return apiVal === mrfVal ? "AGREE" : "CONFLICT";
}

/** Reconcile one API answer against one MRF answer for the same subject+plan. */
export function reconcileClaim(args: {
  kind: "PROVIDER" | "DRUG";
  subjectKey: string;
  planId: string;
  api: CoverageAnswer;
  mrf: CoverageAnswer;
}): ReconciledClaim {
  const { api, mrf } = args;
  const verdict = classify(api.value, mrf.value);

  let agreesWith: SourceTag[] = [];
  let conflictsWith: SourceTag[] = [];
  let reconciledConfidence: number;

  switch (verdict) {
    case "AGREE":
      // Two independent sources concur — confidence above either alone, capped below certainty.
      agreesWith = ["MARKETPLACE_API", "ISSUER_MRF"];
      reconciledConfidence = round2(Math.min(0.95, Math.max(api.confidence, mrf.confidence) + 0.2));
      break;
    case "CONFLICT":
      // Sources contradict — this is the signal. Confidence collapses; the user must confirm.
      conflictsWith = ["MARKETPLACE_API", "ISSUER_MRF"];
      reconciledConfidence = round2(Math.min(api.confidence, mrf.confidence) * 0.5);
      break;
    case "API_ONLY":
      reconciledConfidence = round2(api.confidence * 0.9);
      break;
    case "MRF_ONLY":
      reconciledConfidence = round2(mrf.confidence * 0.9);
      break;
    case "BOTH_UNKNOWN":
      reconciledConfidence = 0.05;
      break;
  }

  // Stamp the reconciliation back onto each answer so any downstream render shows the conflict flag.
  // Each answer names its COUNTERPART source (the API answer conflicts with the MRF, not itself).
  if (verdict === "AGREE") {
    api.agreesWith = ["ISSUER_MRF"];
    mrf.agreesWith = ["MARKETPLACE_API"];
  } else if (verdict === "CONFLICT") {
    api.conflictsWith = ["ISSUER_MRF"];
    mrf.conflictsWith = ["MARKETPLACE_API"];
  }

  return {
    kind: args.kind,
    subjectKey: args.subjectKey,
    planId: args.planId,
    verdict,
    api,
    mrf,
    reconciledConfidence,
    agreesWith,
    conflictsWith,
  };
}

/** Aggregate a batch of reconciled claims into the agreement/conflict counts the eval reports. */
export function summarize(claims: ReconciledClaim[]): ReconcileSummary {
  const counts = { agree: 0, conflict: 0, apiOnly: 0, mrfOnly: 0, bothUnknown: 0 };
  for (const c of claims) {
    if (c.verdict === "AGREE") counts.agree++;
    else if (c.verdict === "CONFLICT") counts.conflict++;
    else if (c.verdict === "API_ONLY") counts.apiOnly++;
    else if (c.verdict === "MRF_ONLY") counts.mrfOnly++;
    else counts.bothUnknown++;
  }
  const comparable = counts.agree + counts.conflict;
  return {
    total: claims.length,
    ...counts,
    agreementRateAmongComparable: comparable === 0 ? null : round2(counts.agree / comparable),
    claims,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
