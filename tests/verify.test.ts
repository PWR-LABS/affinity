import assert from "node:assert/strict";
import { test } from "node:test";

import { matchPlan, type PlanCoverageInputs } from "@/lib/matching/engine";
import type { MatchProfileInput } from "@/lib/matching/types";
import type { MarketplaceProviderCoverage } from "@/lib/marketplace/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import { verifyPlan } from "@/lib/verify/report";

const FETCH = "2026-06-17T12:00:00.000Z";
const AS_OF = "2026-06-17T12:00:00.000Z";

/** Build a one-provider PlanMatch with controllable API coverage + MRF plan list + freshness. */
function planMatch(apiCoverage: string, mrfPlanIds: string[], mrfLastUpdated: string) {
  const profile: MatchProfileInput = { doctors: [{ npi: "1", label: "Dr. Test" }], medications: [] };
  const dataset = datasetFromRecords(
    [{ npi: "1", plans: mrfPlanIds.map((plan_id) => ({ plan_id })), last_updated_on: mrfLastUpdated }],
    [],
    FETCH,
  );
  const inputs: PlanCoverageInputs = {
    planId: "P",
    planLabel: "Test Plan",
    apiProviders: new Map<string, MarketplaceProviderCoverage>([["1", { npi: "1", coverage: apiCoverage }]]),
    apiDrugs: new Map(),
  };
  return matchPlan(profile, inputs, dataset, FETCH);
}

test("clean fresh agreement grades well and needs no confirmation", () => {
  const r = verifyPlan(planMatch("Covered", ["P"], "2026-06-17"), AS_OF);
  assert.ok(["A", "B"].includes(r.grade), r.grade);
  assert.equal(r.checklist.length, 0);
  assert.equal(r.conflictCount, 0);
});

test("a conflict grades worse than clean agreement and lands on the checklist as 'conflict'", () => {
  const agree = verifyPlan(planMatch("Covered", ["P"], "2026-06-17"), AS_OF);
  const conflict = verifyPlan(planMatch("Covered", ["OTHER"], "2026-06-17"), AS_OF);
  assert.ok(conflict.networkConfidenceScore < agree.networkConfidenceScore);
  assert.equal(conflict.conflictCount, 1);
  assert.equal(conflict.checklist[0]?.reason, "conflict");
});

test("stale issuer data is flagged and penalizes the score", () => {
  const fresh = verifyPlan(planMatch("Covered", ["P"], "2026-06-17"), AS_OF);
  const stale = verifyPlan(planMatch("Covered", ["P"], "2024-06-17"), AS_OF);
  assert.equal(stale.freshness.staleClaimCount, 1);
  assert.ok(stale.networkConfidenceScore < fresh.networkConfidenceScore);
});

test("reason priority: unknown coverage reads as 'unknown' on the checklist", () => {
  // API silent + provider absent from the issuer file → BOTH_UNKNOWN.
  const profile: MatchProfileInput = { doctors: [{ npi: "404", label: "Dr. Absent" }], medications: [] };
  const dataset = datasetFromRecords([], [], FETCH);
  const m = matchPlan(profile, { planId: "P", planLabel: "P", apiProviders: new Map(), apiDrugs: new Map() }, dataset, FETCH);
  const r = verifyPlan(m, AS_OF);
  assert.equal(r.unknownCount, 1);
  assert.equal(r.checklist[0]?.reason, "unknown");
});

test("every checklist item has an actionable instruction and the report has an honest headline", () => {
  const r = verifyPlan(planMatch("Covered", ["OTHER"], "2026-06-17"), AS_OF);
  assert.ok(r.checklist.every((c) => /confirm|ask|call/i.test(c.action)));
  assert.match(r.headline, /confidence/i);
  assert.match(r.headline, /confirm|verify/i);
});
