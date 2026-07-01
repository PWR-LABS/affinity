/**
 * Network-bridge analysis — group a plan's reconciled provider matches by health system, grade whether
 * the plan keeps each system in-network, flag any *critical* provider that would go out-of-network, and
 * rank plans so a true bridge surfaces first and a plan that drops a dealbreaker sinks.
 *
 * Pure + deterministic; consumes PlanMatch[] from the M1 engine, so it behaves identically on fixtures
 * or live data. It never emits a bare "in-network" claim — every system carries its reconciled
 * confidence and the providers still to confirm, per the doctrine.
 */
import type { MatchedSubject, PlanMatch } from "@/lib/matching/types";

import type {
  BridgeReport,
  BridgeStatus,
  HealthSystem,
  PlanBridge,
  ProviderSystemTag,
  SystemCoverage,
  SystemCoverageStatus,
} from "./types";

/** A system is "kept" (you don't lose it) only when its providers are in-network. */
const KEPT_STATUSES: ReadonlySet<SystemCoverageStatus> = new Set<SystemCoverageStatus>([
  "covered",
  "covered_unverified",
]);

function isCovered(s: MatchedSubject): boolean {
  return s.status === "covered" || s.status === "covered_unverified";
}

function systemStatusFor(providers: MatchedSubject[]): SystemCoverageStatus {
  const total = providers.length;
  if (total === 0) return "unknown";
  const covered = providers.filter(isCovered);
  if (covered.length === 0) {
    return providers.every((p) => p.status === "unknown") ? "unknown" : "not_covered";
  }
  if (covered.length < total) return "partial";
  return covered.every((p) => p.status === "covered") ? "covered" : "covered_unverified";
}

function coverageBySystem(
  match: PlanMatch,
  tagByNpi: Map<string, ProviderSystemTag>,
  requiredSystems: HealthSystem[],
): SystemCoverage[] {
  return requiredSystems.map((system) => {
    const inSystem = match.providers.filter((p) => tagByNpi.get(p.subjectKey)?.system === system);
    return {
      system,
      status: systemStatusFor(inSystem),
      providersTotal: inSystem.length,
      providersCovered: inSystem.filter(isCovered).length,
      confidence: mean(inSystem.map((p) => p.reconciled.reconciledConfidence)),
      confirm: inSystem.filter((p) => p.needsConfirmation),
    };
  });
}

function bridgeStatusFor(systems: SystemCoverage[]): BridgeStatus {
  const kept = systems.filter((s) => KEPT_STATUSES.has(s.status)).length;
  if (systems.length > 0 && kept === systems.length) return "bridges_all";
  if (kept > 0) return "single_system";
  return systems.some((s) => s.providersCovered > 0) ? "partial" : "none";
}

function scoreFor(systems: SystemCoverage[], criticalKeptFraction: number): number {
  const kept = systems.filter((s) => KEPT_STATUSES.has(s.status));
  // Systems kept dominates (integer step); critical providers then confidence break ties within a tier.
  return round2(kept.length + 0.3 * criticalKeptFraction + 0.1 * mean(kept.map((s) => s.confidence)));
}

function headlineFor(args: {
  bridgeStatus: BridgeStatus;
  systems: SystemCoverage[];
  systemsKept: HealthSystem[];
  systemsLost: HealthSystem[];
  criticalGaps: MatchedSubject[];
}): string {
  const { bridgeStatus, systems, systemsKept, systemsLost, criticalGaps } = args;
  const keptCov = systems.filter((s) => KEPT_STATUSES.has(s.status));
  const minKeptPct = keptCov.length ? Math.round(Math.min(...keptCov.map((s) => s.confidence)) * 100) : 0;
  const confirmCount = systems.reduce((n, s) => n + s.confirm.length, 0);

  const lead =
    bridgeStatus === "bridges_all"
      ? `Keeps every system in-network (${systemsKept.join(" + ")}) — shown in-network at ≥${minKeptPct}% confidence`
      : bridgeStatus === "single_system"
        ? `Keeps ${systemsKept.join(", ")} but drops ${systemsLost.join(", ")}`
        : bridgeStatus === "partial"
          ? "No system kept whole — only some providers shown in-network"
          : "Keeps none of your doctors in-network";

  const gap = criticalGaps.length
    ? ` · ⚠️ puts a must-keep provider out-of-network: ${criticalGaps
        .map((g) => g.label ?? `NPI ${g.subjectKey}`)
        .join(", ")}`
    : "";
  const confirm = confirmCount
    ? ` · confirm ${confirmCount} provider${confirmCount > 1 ? "s" : ""} with the office(s) before enrolling`
    : " · still confirm directly with each office before enrolling";
  return `${lead}${gap}${confirm}`;
}

/** Group every plan's provider matches by health system, grade the bridge, and rank best-first. */
export function analyzeBridges(args: {
  matches: PlanMatch[];
  tags: ProviderSystemTag[];
  asOf: string;
  isLive?: boolean;
  notes?: string[];
}): BridgeReport {
  const tagByNpi = new Map(args.tags.map((t) => [t.npi, t]));
  const criticalNpis = new Set(args.tags.filter((t) => t.critical).map((t) => t.npi));
  const requiredSystems = [...new Set(args.tags.map((t) => t.system))].sort();
  const criticalTotal = criticalNpis.size;

  const plans: PlanBridge[] = args.matches.map((match) => {
    const systems = coverageBySystem(match, tagByNpi, requiredSystems);
    const criticalGaps = match.providers.filter((p) => criticalNpis.has(p.subjectKey) && !isCovered(p));
    const systemsKept = systems.filter((s) => KEPT_STATUSES.has(s.status)).map((s) => s.system);
    const systemsLost = systems.filter((s) => !KEPT_STATUSES.has(s.status)).map((s) => s.system);
    const bridgeStatus = bridgeStatusFor(systems);
    const criticalKeptFraction =
      criticalTotal === 0 ? 1 : (criticalTotal - criticalGaps.length) / criticalTotal;
    return {
      planId: match.planId,
      planLabel: match.planLabel,
      systems,
      bridgeStatus,
      systemsKept,
      systemsLost,
      criticalGaps,
      headline: headlineFor({ bridgeStatus, systems, systemsKept, systemsLost, criticalGaps }),
      score: scoreFor(systems, criticalKeptFraction),
    };
  });

  plans.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.planId.localeCompare(b.planId)));

  return {
    requiredSystems,
    plans,
    anyBridges: plans.some((p) => p.bridgeStatus === "bridges_all"),
    asOf: args.asOf,
    isLive: args.isLive ?? false,
    notes: args.notes ?? [],
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : round2(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
