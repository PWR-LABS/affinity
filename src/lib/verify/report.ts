/**
 * M3 verification report — grade the trustworthiness of a plan's coverage answers and produce the
 * confirm-checklist.
 *
 * The score is the mean reconciled confidence (which already folds in source weight, freshness decay,
 * and the conflict penalty from M0) minus an explicit penalty for stale issuer data — so corroborated,
 * fresh data grades high and conflicting/one-sided/stale data grades low. The checklist names every
 * subject that isn't a clean high-confidence agreement, with the reason and a plain-language action.
 */
import type { MatchedSubject, PlanMatch } from "@/lib/matching/types";

import type {
  ChecklistItem,
  ChecklistReason,
  ConfidenceGrade,
  FreshnessSummary,
  VerificationReport,
} from "./types";

/** Issuer data older than this is treated as stale for the freshness penalty. */
const STALE_DAYS = 180;

export function verifyPlan(plan: PlanMatch, asOf: string): VerificationReport {
  const subjects: MatchedSubject[] = [...plan.providers, ...plan.drugs];
  const total = subjects.length;

  let agree = 0;
  let conflict = 0;
  let unverified = 0;
  let unknown = 0;
  for (const s of subjects) {
    switch (s.reconciled.verdict) {
      case "AGREE":
        agree++;
        break;
      case "CONFLICT":
        conflict++;
        break;
      case "API_ONLY":
      case "MRF_ONLY":
        unverified++;
        break;
      case "BOTH_UNKNOWN":
        unknown++;
        break;
    }
  }

  const meanConfidence =
    total === 0 ? 0 : subjects.reduce((sum, s) => sum + s.reconciled.reconciledConfidence, 0) / total;

  const freshness = summarizeFreshness(subjects, asOf);
  const stalePenalty =
    freshness.datedClaimCount === 0 ? 0 : 0.1 * (freshness.staleClaimCount / freshness.datedClaimCount);
  const score = clamp01(round2(meanConfidence - stalePenalty));
  const grade = gradeFor(score);

  const checklist = subjects.filter((s) => s.needsConfirmation).map((s) => toChecklistItem(s, plan.planLabel));

  return {
    planId: plan.planId,
    planLabel: plan.planLabel,
    networkConfidenceScore: score,
    grade,
    totalClaims: total,
    agreeCount: agree,
    conflictCount: conflict,
    unverifiedCount: unverified,
    unknownCount: unknown,
    freshness,
    checklist,
    headline: buildHeadline({ grade, score, agree, total, conflict, unknown, unverified, freshness, checklist }),
  };
}

function summarizeFreshness(subjects: MatchedSubject[], asOf: string): FreshnessSummary {
  const asOfMs = Date.parse(asOf);
  const dates: string[] = [];
  let stale = 0;
  for (const s of subjects) {
    // The issuer MRF is the source that reports its own freshness; the API rarely does.
    const d = s.reconciled.mrf.provenance.sourceLastUpdated;
    if (!d) continue;
    dates.push(d.slice(0, 10));
    const ageDays = (asOfMs - Date.parse(d)) / 86_400_000;
    if (Number.isFinite(ageDays) && ageDays > STALE_DAYS) stale++;
  }
  dates.sort();
  return {
    oldestSourceDate: dates[0],
    newestSourceDate: dates[dates.length - 1],
    staleClaimCount: stale,
    datedClaimCount: dates.length,
  };
}

function toChecklistItem(s: MatchedSubject, planLabel?: string): ChecklistItem {
  const reason = reasonFor(s);
  const plan = planLabel ?? "this plan";
  const who = s.label ?? (s.kind === "PROVIDER" ? `NPI ${s.subjectKey}` : `RxCUI ${s.subjectKey}`);
  const action =
    s.kind === "PROVIDER"
      ? `Call ${who}'s office and confirm they are in-network for ${plan} (and accepting new patients).`
      : `Ask ${plan} or your pharmacy to confirm ${who} is on the formulary and at what tier (and any prior authorization).`;
  return { kind: s.kind, subjectKey: s.subjectKey, label: s.label, reason, action };
}

/** Highest-priority reason a subject needs confirmation. */
function reasonFor(s: MatchedSubject): ChecklistReason {
  if (s.reconciled.verdict === "CONFLICT") return "conflict";
  if (s.status === "unknown") return "unknown";
  if (s.status === "covered_unverified" || s.status === "not_covered_unverified") return "unverified";
  return "low_confidence";
}

function gradeFor(score: number): ConfidenceGrade {
  if (score >= 0.85) return "A";
  if (score >= 0.7) return "B";
  if (score >= 0.5) return "C";
  if (score >= 0.3) return "D";
  return "F";
}

function buildHeadline(a: {
  grade: ConfidenceGrade;
  score: number;
  agree: number;
  total: number;
  conflict: number;
  unknown: number;
  unverified: number;
  freshness: FreshnessSummary;
  checklist: ChecklistItem[];
}): string {
  const pct = Math.round(a.score * 100);
  const parts: string[] = [`Network confidence ${a.grade} (${pct}%): ${a.agree} of ${a.total} answers corroborated across both sources`];
  const flags: string[] = [];
  if (a.conflict) flags.push(`${a.conflict} conflict${a.conflict > 1 ? "s" : ""}`);
  if (a.unverified) flags.push(`${a.unverified} one-sided`);
  if (a.unknown) flags.push(`${a.unknown} unknown`);
  if (flags.length) parts.push(flags.join(", "));
  if (a.freshness.newestSourceDate) {
    const span = a.freshness.oldestSourceDate === a.freshness.newestSourceDate
      ? `issuer data as of ${a.freshness.newestSourceDate}`
      : `issuer data ${a.freshness.oldestSourceDate}–${a.freshness.newestSourceDate}`;
    if (a.freshness.staleClaimCount) parts.push(`${span} (${a.freshness.staleClaimCount} stale)`);
    else parts.push(span);
  }
  parts.push(
    a.checklist.length
      ? `Confirm ${a.checklist.length} item${a.checklist.length > 1 ? "s" : ""} with the provider/plan before enrolling.`
      : `Nothing flagged to confirm, but verify with the provider before enrolling.`,
  );
  return parts.join(" · ");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
