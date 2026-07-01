/**
 * Network-bridge types — does a single plan span the health systems a household actually needs?
 *
 * In many metros, care is split between two or three dominant health systems, and narrow marketplace
 * plans usually contract with ONE system, not both. A household whose doctors straddle two systems faces
 * a make-or-break question the per-plan match summary doesn't answer head-on: is there any plan that
 * keeps ALL of them in-network — and if not, exactly which doctor (and which system) falls out?
 */
import type { MatchedSubject } from "@/lib/matching/types";

/** A health-system label, free-form so the layer generalizes beyond any one market. */
export type HealthSystem = string;

/** Tags a household provider with the system they practice in. */
export interface ProviderSystemTag {
  npi: string;
  system: HealthSystem;
  label?: string;
  /** Losing this provider out-of-network is a dealbreaker (e.g. the specialist managing an active condition). */
  critical?: boolean;
}

export type SystemCoverageStatus =
  | "covered" //            every required provider in this system is a clean in-network agreement
  | "covered_unverified" // all in-network, but at least one rests on a single source / lower confidence
  | "partial" //            some in-network, some not — the system is only partly kept
  | "not_covered" //        no required provider in this system is in-network
  | "unknown"; //           no source spoke for this system's providers

export interface SystemCoverage {
  system: HealthSystem;
  status: SystemCoverageStatus;
  providersTotal: number;
  providersCovered: number;
  /** Mean reconciled confidence across this system's providers (0..1). */
  confidence: number;
  /** Providers in this system that are NOT a clean high-confidence in-network answer — confirm these. */
  confirm: MatchedSubject[];
}

export type BridgeStatus =
  | "bridges_all" //   keeps every required system in-network (the rare win)
  | "single_system" // keeps at least one required system but loses another
  | "partial" //       keeps no system whole, but at least one provider is in-network
  | "none"; //         keeps no provider in-network

export interface PlanBridge {
  planId: string;
  planLabel?: string;
  systems: SystemCoverage[];
  bridgeStatus: BridgeStatus;
  systemsKept: HealthSystem[];
  systemsLost: HealthSystem[];
  /** Critical providers that would fall out-of-network on this plan — the dealbreakers. */
  criticalGaps: MatchedSubject[];
  /** Honest one-liner: what it keeps, what it costs you, and that you must confirm. */
  headline: string;
  /** Rank key (higher = better): systems kept dominate, then critical providers, then confidence. */
  score: number;
}

export interface BridgeReport {
  /** Systems the household requires, derived from the provider tags. */
  requiredSystems: HealthSystem[];
  /** Plans ranked best-bridge-first. */
  plans: PlanBridge[];
  /** The make-or-break answer: does ANY plan keep every required system in-network? */
  anyBridges: boolean;
  asOf: string;
  /** false = fixture/demo (no API key); true = live Marketplace + issuer MRF. */
  isLive: boolean;
  notes: string[];
}
