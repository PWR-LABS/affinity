import assert from "node:assert/strict";
import { test } from "node:test";

import { loadDemoDecisionBoard } from "@/lib/decision/fixture";

test("the demo board assembles all three engines per plan", async () => {
  const board = await loadDemoDecisionBoard();
  assert.equal(board.isLive, false);
  assert.ok(board.plans.length >= 2);
  for (const p of board.plans) {
    assert.ok(p.trueCost.trueAnnualCostUsd > 0); // M2
    assert.ok(p.match.summary.doctorsTotal > 0); // M1
    assert.ok(["A", "B", "C", "D", "F"].includes(p.verify.grade)); // M3
  }
});

test("the board is ranked by true annual cost, not premium", async () => {
  const board = await loadDemoDecisionBoard();
  const costs = board.plans.map((p) => p.trueCost.trueAnnualCostUsd);
  assert.deepEqual(costs, [...costs].sort((a, b) => a - b));

  const cheapestPremium = [...board.plans].sort(
    (a, b) => a.trueCost.grossAnnualPremiumUsd - b.trueCost.grossAnnualPremiumUsd,
  )[0];
  // Doctrine: the lowest-premium plan should not be the rank-1 (true-cost) plan in this scenario.
  assert.notEqual(cheapestPremium.planId, board.plans[0].planId);
});

test("a disputed coverage answer surfaces on the plan's confirm checklist", async () => {
  const board = await loadDemoDecisionBoard();
  const withConflict = board.plans.find((p) => p.verify.conflictCount > 0);
  assert.ok(withConflict, "expected at least one plan with a conflict");
  assert.ok(withConflict.verify.checklist.some((c) => c.reason === "conflict"));
});
