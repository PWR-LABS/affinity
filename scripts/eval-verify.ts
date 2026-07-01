/**
 * eval:verify — the M3 gate (network-truth / verification surface).
 *
 * Reuses the M1 match fixture to produce per-plan verification reports and checks they line up with the
 * matching layer (the checklist names exactly the subjects needing confirmation, with correct reasons,
 * and the freshness summary is right). Then property checks on synthetic plans prove the score behaves:
 * a conflict grades worse than clean agreement, and stale issuer data is penalized. Exit 0/1.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { matchPlan, matchProfile, type PlanCoverageInputs } from "@/lib/matching/engine";
import type { MatchProfileInput } from "@/lib/matching/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import type { MarketplaceDrugCoverage, MarketplaceProviderCoverage } from "@/lib/marketplace/types";
import type { MrfDrug, MrfProvider } from "@/lib/mrf/types";
import { verifyPlan } from "@/lib/verify/report";

const FIXTURE_PATH = path.join(process.cwd(), "data", "fixtures", "match-sample.json");
const AS_OF = "2026-06-17T12:00:00.000Z";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function fixtureChecks(): Promise<void> {
  const fx = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  const profile = fx.profile as MatchProfileInput;
  const dataset = datasetFromRecords(fx.mrfProviders as MrfProvider[], fx.mrfDrugs as MrfDrug[], fx.fetchedAt);
  const inputs: PlanCoverageInputs[] = (fx.plans as Array<Record<string, unknown>>).map((p) => ({
    planId: p.planId as string,
    planLabel: p.planLabel as string,
    apiProviders: new Map((p.apiProviders as MarketplaceProviderCoverage[]).map((c) => [c.npi, c])),
    apiDrugs: new Map((p.apiDrugs as MarketplaceDrugCoverage[]).map((c) => [c.rxcui, c])),
  }));
  const matches = matchProfile(profile, inputs, dataset, fx.fetchedAt);

  console.log("\n  Verification reports (from the M1 match fixture):");
  const reports = matches.map((m) => verifyPlan(m, AS_OF));
  const byId = new Map(reports.map((r) => [r.planId, r]));
  for (const r of reports) console.log(`   [${r.grade}] ${r.headline}`);

  // The checklist must equal M1's confirm set, per plan.
  for (const m of matches) {
    const r = byId.get(m.planId)!;
    const gotKeys = r.checklist.map((c) => c.subjectKey).sort();
    const wantKeys = m.summary.confirmList.map((c) => c.subjectKey).sort();
    check(`${m.planId}: checklist == M1 confirm set`, JSON.stringify(gotKeys) === JSON.stringify(wantKeys), `${gotKeys} vs ${wantKeys}`);
    check(`${m.planId}: every checklist item has an action`, r.checklist.every((c) => c.action.length > 10));
    check(`${m.planId}: counts sum to total`, r.agreeCount + r.conflictCount + r.unverifiedCount + r.unknownCount === r.totalClaims);
    check(`${m.planId}: data fresh (no stale)`, r.freshness.staleClaimCount === 0 && r.freshness.newestSourceDate === "2026-06-17");
  }

  // Reason logic: same subject, different verdict across plans → different reason.
  const p1 = byId.get("PLAN0001")!;
  const p2 = byId.get("PLAN0002")!;
  const reasonOf = (r: typeof p1, key: string) => r.checklist.find((c) => c.subjectKey === key)?.reason;
  check("PLAN0001: NPI 3333333333 reason = conflict", reasonOf(p1, "3333333333") === "conflict", `${reasonOf(p1, "3333333333")}`);
  check("PLAN0001: RxCUI 310965 reason = unverified", reasonOf(p1, "310965") === "unverified", `${reasonOf(p1, "310965")}`);
  check("PLAN0002: NPI 3333333333 reason = unverified", reasonOf(p2, "3333333333") === "unverified", `${reasonOf(p2, "3333333333")}`);
  check("PLAN0002: RxCUI 310965 reason = unknown", reasonOf(p2, "310965") === "unknown", `${reasonOf(p2, "310965")}`);
  check("PLAN0001 has the conflict the moat is about", p1.conflictCount === 1);
}

/** Build a single-plan PlanMatch from explicit API + MRF records for property tests. */
function syntheticPlan(args: {
  planId: string;
  npi: string;
  apiCoverage: string;
  mrfPlanIds: string[];
  mrfLastUpdated: string;
  fetchedAt: string;
}) {
  const profile: MatchProfileInput = { doctors: [{ npi: args.npi, label: "Dr. Test" }], medications: [] };
  const dataset = datasetFromRecords(
    [{ npi: args.npi, plans: args.mrfPlanIds.map((plan_id) => ({ plan_id })), last_updated_on: args.mrfLastUpdated }],
    [],
    args.fetchedAt,
  );
  const inputs: PlanCoverageInputs = {
    planId: args.planId,
    planLabel: `Plan ${args.planId}`,
    apiProviders: new Map<string, MarketplaceProviderCoverage>([[args.npi, { npi: args.npi, coverage: args.apiCoverage }]]),
    apiDrugs: new Map(),
  };
  return matchPlan(profile, inputs, dataset, args.fetchedAt);
}

function propertyChecks(): void {
  const fetchedAt = "2026-06-17T12:00:00.000Z";

  // Fresh clean agreement (in-network, MRF lists the plan, updated today).
  const agree = verifyPlan(
    syntheticPlan({ planId: "P", npi: "1000000001", apiCoverage: "Covered", mrfPlanIds: ["P"], mrfLastUpdated: "2026-06-17", fetchedAt }),
    AS_OF,
  );
  // Conflict (API in-network, issuer file lists a different plan → not in this plan).
  const conflict = verifyPlan(
    syntheticPlan({ planId: "P", npi: "1000000001", apiCoverage: "Covered", mrfPlanIds: ["OTHER"], mrfLastUpdated: "2026-06-17", fetchedAt }),
    AS_OF,
  );
  // Stale clean agreement (same as `agree` but issuer data is 18 months old).
  const stale = verifyPlan(
    syntheticPlan({ planId: "P", npi: "1000000001", apiCoverage: "Covered", mrfPlanIds: ["P"], mrfLastUpdated: "2025-01-01", fetchedAt }),
    AS_OF,
  );

  check("conflict scores below clean agreement", conflict.networkConfidenceScore < agree.networkConfidenceScore, `${conflict.networkConfidenceScore} vs ${agree.networkConfidenceScore}`);
  check("conflict checklist reason = conflict", conflict.checklist[0]?.reason === "conflict");
  check("clean fresh agreement needs no confirmation", agree.checklist.length === 0, `${agree.checklist.length}`);
  check("stale data is flagged stale", stale.freshness.staleClaimCount === 1, `${stale.freshness.staleClaimCount}`);
  check("stale data scores below fresh", stale.networkConfidenceScore < agree.networkConfidenceScore, `${stale.networkConfidenceScore} vs ${agree.networkConfidenceScore}`);
  check("grade ordering: agree ≥ stale ≥ conflict", agree.grade <= stale.grade && stale.grade <= conflict.grade, `${agree.grade}/${stale.grade}/${conflict.grade}`);

  console.log("\n  Property checks:");
  console.log(`   clean agree:  ${agree.grade} (${agree.networkConfidenceScore})  — ${agree.checklist.length} to confirm`);
  console.log(`   stale agree:  ${stale.grade} (${stale.networkConfidenceScore})  — ${stale.freshness.staleClaimCount} stale`);
  console.log(`   conflict:     ${conflict.grade} (${conflict.networkConfidenceScore})  — reason "${conflict.checklist[0]?.reason}"`);
}

async function main(): Promise<void> {
  console.log("eval:verify — [affinity.] network-truth / verification");
  await fixtureChecks();
  propertyChecks();
  if (failures.length) {
    console.log(`\n  ✗ FAIL (${failures.length}):`);
    for (const f of failures) console.log(`     - ${f}`);
    console.log("\nFAIL\n");
    process.exit(1);
  }
  console.log(`\n  ✓ checklists match the match layer; scoring penalizes conflict + stale data; reasons correct.`);
  console.log("\nPASS\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("eval:verify crashed:", err);
  process.exit(1);
});
