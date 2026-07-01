import assert from "node:assert/strict";
import { test } from "node:test";

import { matchPlan, type PlanCoverageInputs } from "@/lib/matching/engine";
import type { MatchProfileInput } from "@/lib/matching/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import { analyzeBridges } from "@/lib/network/bridge";
import type { ProviderSystemTag } from "@/lib/network/types";

const FETCH = "2026-06-17T12:00:00.000Z";

// Synthetic scenario (no real people): three doctors across two competing systems. Chen (CVH) is the
// dealbreaker — an active condition needs ongoing specialist care; Reed + Nair (HPH) are not (hematology
// is a ~once-a-year formality).
const PROFILE: MatchProfileInput = {
  doctors: [
    { npi: "C", label: "Chen" },
    { npi: "R", label: "Reed" },
    { npi: "N", label: "Nair" },
  ],
  medications: [],
};

const TAGS: ProviderSystemTag[] = [
  { npi: "C", system: "CVH", critical: true },
  { npi: "R", system: "HPH" },
  { npi: "N", system: "HPH" },
];

// Issuer MRF: each provider is listed for exactly the plans they're truly in-network for. A provider
// present-but-not-listed for a plan reconciles to a definite "no" (the dataset's documented semantic).
const dataset = datasetFromRecords(
  [
    { npi: "C", plans: [{ plan_id: "PPO" }, { plan_id: "CVH" }], last_updated_on: "2026-06-17" },
    { npi: "R", plans: [{ plan_id: "PPO" }, { plan_id: "HPH" }], last_updated_on: "2026-06-17" },
    { npi: "N", plans: [{ plan_id: "PPO" }, { plan_id: "HPH" }], last_updated_on: "2026-06-17" },
  ],
  [],
  FETCH,
);

function matchFor(planId: string, coverage: Record<string, string>) {
  const inputs: PlanCoverageInputs = {
    planId,
    planLabel: planId,
    apiProviders: new Map(Object.entries(coverage).map(([npi, c]) => [npi, { npi, coverage: c }])),
    apiDrugs: new Map(),
  };
  return matchPlan(PROFILE, inputs, dataset, FETCH);
}

const ppoMatch = () => matchFor("PPO", { C: "Covered", R: "Covered", N: "Covered" });
const hphMatch = () => matchFor("HPH", { C: "NotCovered", R: "Covered", N: "Covered" });
const cvhMatch = () => matchFor("CVH", { C: "Covered", R: "NotCovered", N: "NotCovered" });

test("a plan covering both systems is classified as a bridge with no critical gaps", () => {
  const report = analyzeBridges({ matches: [ppoMatch()], tags: TAGS, asOf: FETCH });
  assert.equal(report.anyBridges, true);
  const p = report.plans[0];
  assert.equal(p.bridgeStatus, "bridges_all");
  assert.deepEqual([...p.systemsKept].sort(), ["CVH", "HPH"]);
  assert.equal(p.systemsLost.length, 0);
  assert.equal(p.criticalGaps.length, 0);
});

test("dropping the critical CVH ophthalmologist flags a critical gap and loses the system", () => {
  const report = analyzeBridges({ matches: [hphMatch()], tags: TAGS, asOf: FETCH });
  const p = report.plans[0];
  assert.equal(p.bridgeStatus, "single_system");
  assert.deepEqual(p.systemsKept, ["HPH"]);
  assert.deepEqual(p.systemsLost, ["CVH"]);
  assert.deepEqual(
    p.criticalGaps.map((g) => g.subjectKey),
    ["C"],
  );
  assert.equal(report.anyBridges, false);
});

test("between two single-system plans, the one keeping the critical provider ranks higher", () => {
  const report = analyzeBridges({ matches: [hphMatch(), cvhMatch()], tags: TAGS, asOf: FETCH });
  // CVH keeps Chen (critical); HPH drops her — CVH must rank first though both are single-system.
  assert.equal(report.plans[0].planId, "CVH");
  assert.equal(report.plans[1].planId, "HPH");
  assert.ok(report.plans[0].score > report.plans[1].score);
});

test("a plan covering no system is 'none', not a silent miss", () => {
  const none = matchFor("NAR", { C: "NotCovered", R: "NotCovered", N: "NotCovered" });
  const report = analyzeBridges({ matches: [none], tags: TAGS, asOf: FETCH });
  assert.equal(report.plans[0].bridgeStatus, "none");
  assert.equal(report.anyBridges, false);
});

test("headlines stay honest — name the trade-off, the critical gap, and the need to confirm", () => {
  const report = analyzeBridges({ matches: [hphMatch()], tags: TAGS, asOf: FETCH });
  const h = report.plans[0].headline;
  assert.match(h, /drops CVH/);
  assert.match(h, /out-of-network/);
  assert.match(h, /confirm/i);
});
