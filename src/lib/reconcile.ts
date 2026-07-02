/**
 * Network-truth reconciliation — the [affinity.] moat, in its smallest honest form.
 *
 * Everyone can fetch coverage data; nobody makes it trustworthy. This module fuses INDEPENDENT
 * answers about the same (provider|drug, plan) pair — the Marketplace API, the issuer's QHP MRF, the
 * commercial Transparency-in-Coverage index, later crowd + secret-shopper — and emits a verdict plus a
 * reconciled confidence. Agreement across k sources compounds confidence toward a hard cap; a single
 * conflict ("one source says in-network, another says out") collapses it and is surfaced, never
 * silently resolved. The 2-way API↔MRF form (M0's moat demo) is preserved as a thin wrapper over the
 * N-way core, so both speak with one set of rules.
 */
import type { CoverageAnswer, SourceTag, Tristate } from "@/lib/provenance";

export type ReconcileVerdict = "AGREE" | "CONFLICT" | "API_ONLY" | "MRF_ONLY" | "BOTH_UNKNOWN";

/** N-way verdicts: *_ONLY generalizes to SINGLE_SOURCE; BOTH_UNKNOWN to ALL_UNKNOWN. */
export type MultiReconcileVerdict = "AGREE" | "CONFLICT" | "SINGLE_SOURCE" | "ALL_UNKNOWN";

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

export interface MultiReconciledClaim {
  kind: "PROVIDER" | "DRUG";
  subjectKey: string;
  planId: string;
  verdict: MultiReconcileVerdict;
  /** Every input answer, reconciliation stamps applied (agreesWith/conflictsWith name counterparts). */
  answers: CoverageAnswer[];
  /** How many sources gave a definite yes/no. */
  knownCount: number;
  /**
   * The value the sources agree on when verdict is AGREE or SINGLE_SOURCE; "unknown" when nothing is
   * known — and, per doctrine, "unknown" on CONFLICT too: a majority never silently wins a conflict.
   */
  consensus: Tristate;
  /** Who said yes / no — the honest breakdown a surface can show on conflict. */
  votes: { yes: SourceTag[]; no: SourceTag[] };
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

/** Hard ceiling — no stack of files ever reaches certainty; only real-world confirmation could. */
const CONFIDENCE_CAP = 0.95;
/** Each corroborating source beyond the first adds this much (pre-cap). Two sources = the M0 +0.2. */
const CORROBORATION_BONUS = 0.2;
/** A conflict halves the weakest participant — the collapse that pushes the pair onto the checklist. */
const CONFLICT_FACTOR = 0.5;
/** A lone source keeps most of its own confidence but is discounted for being uncorroborated. */
const SINGLE_SOURCE_FACTOR = 0.9;
const ALL_UNKNOWN_CONFIDENCE = 0.05;

/**
 * Reconcile ANY number of independent answers for the same subject+plan — the N-way core.
 * Rules: agreement among k known sources compounds (+bonus per corroborator, capped); ANY disagreement
 * is a CONFLICT that collapses confidence, regardless of majority; unknowns never vote.
 */
export function reconcileMany(args: {
  kind: "PROVIDER" | "DRUG";
  subjectKey: string;
  planId: string;
  answers: CoverageAnswer[];
}): MultiReconciledClaim {
  const { answers } = args;
  const known = answers.filter((a) => a.value !== "unknown");
  const yes = known.filter((a) => a.value === "yes");
  const no = known.filter((a) => a.value === "no");
  const votes = { yes: yes.map(src), no: no.map(src) };

  let verdict: MultiReconcileVerdict;
  let consensus: Tristate = "unknown";
  let reconciledConfidence: number;
  let agreesWith: SourceTag[] = [];
  let conflictsWith: SourceTag[] = [];

  if (known.length === 0) {
    verdict = "ALL_UNKNOWN";
    reconciledConfidence = ALL_UNKNOWN_CONFIDENCE;
  } else if (known.length === 1) {
    verdict = "SINGLE_SOURCE";
    consensus = known[0].value;
    reconciledConfidence = round2(known[0].confidence * SINGLE_SOURCE_FACTOR);
  } else if (yes.length === 0 || no.length === 0) {
    verdict = "AGREE";
    consensus = known[0].value;
    agreesWith = known.map(src);
    const maxConf = Math.max(...known.map((a) => a.confidence));
    reconciledConfidence = round2(Math.min(CONFIDENCE_CAP, maxConf + CORROBORATION_BONUS * (known.length - 1)));
    // Stamp each answer with the counterparts that corroborate it.
    for (const a of known) a.agreesWith = known.filter((b) => b !== a).map(src);
  } else {
    verdict = "CONFLICT";
    // Doctrine: a conflict is surfaced, never outvoted — consensus stays "unknown".
    conflictsWith = known.map(src);
    const minConf = Math.min(...known.map((a) => a.confidence));
    reconciledConfidence = round2(minConf * CONFLICT_FACTOR);
    // Stamp each answer with who agrees with it and who contradicts it.
    for (const a of known) {
      const same = known.filter((b) => b !== a && b.value === a.value);
      const other = known.filter((b) => b.value !== a.value);
      if (same.length) a.agreesWith = same.map(src);
      a.conflictsWith = other.map(src);
    }
  }

  return {
    kind: args.kind,
    subjectKey: args.subjectKey,
    planId: args.planId,
    verdict,
    answers,
    knownCount: known.length,
    consensus,
    votes,
    reconciledConfidence,
    agreesWith,
    conflictsWith,
  };
}

/** Reconcile one API answer against one MRF answer — the M0 2-way form, now a view over the N-way core. */
export function reconcileClaim(args: {
  kind: "PROVIDER" | "DRUG";
  subjectKey: string;
  planId: string;
  api: CoverageAnswer;
  mrf: CoverageAnswer;
}): ReconciledClaim {
  const { api, mrf } = args;
  const multi = reconcileMany({ kind: args.kind, subjectKey: args.subjectKey, planId: args.planId, answers: [api, mrf] });

  const verdict: ReconcileVerdict =
    multi.verdict === "AGREE"
      ? "AGREE"
      : multi.verdict === "CONFLICT"
        ? "CONFLICT"
        : multi.verdict === "ALL_UNKNOWN"
          ? "BOTH_UNKNOWN"
          : api.value !== "unknown"
            ? "API_ONLY"
            : "MRF_ONLY";

  return {
    kind: args.kind,
    subjectKey: args.subjectKey,
    planId: args.planId,
    verdict,
    api,
    mrf,
    reconciledConfidence: multi.reconciledConfidence,
    agreesWith: multi.agreesWith,
    conflictsWith: multi.conflictsWith,
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

function src(a: CoverageAnswer): SourceTag {
  return a.provenance.source;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
