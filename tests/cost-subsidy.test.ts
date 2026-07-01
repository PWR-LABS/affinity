import assert from "node:assert/strict";
import { test } from "node:test";

import { applicablePercent, csrFor, fplFor, POLICY_2026 } from "@/lib/cost/policy";
import { computeSubsidy } from "@/lib/cost/subsidy";

const P = POLICY_2026;
function sub(income: number, metal: "Silver" | "Bronze" = "Silver", size = 1) {
  return computeSubsidy({ incomeUsd: income, householdSize: size, benchmarkMonthlyPremiumUsd: 500, metalLevel: metal });
}

test("FPL scales with household size", () => {
  assert.equal(fplFor(1, P), 15650);
  assert.equal(fplFor(4, P), 15650 + 3 * 5500);
});

test("below the Medicaid floor → ineligible, no PTC", () => {
  const s = sub(10000);
  assert.equal(s.eligible, false);
  assert.equal(s.aptcAnnualUsd, 0);
});

test("above the 2026 cliff (>400% FPL) → ineligible, no PTC", () => {
  const s = sub(100000);
  assert.equal(s.eligible, false);
  assert.equal(s.aptcAnnualUsd, 0);
});

test("a mid-range household gets a positive PTC", () => {
  const s = sub(25000);
  assert.equal(s.eligible, true);
  assert.ok(s.aptcAnnualUsd > 0);
});

test("PTC is monotonic: higher income → lower credit", () => {
  assert.ok(sub(20000).aptcAnnualUsd > sub(30000).aptcAnnualUsd);
});

test("PTC reproduces the §36B / KFF formula", () => {
  const income = 25000;
  const s = sub(income);
  const appPct = applicablePercent(s.fplPercent, P);
  // s.fplPercent is rounded; recompute expected contribution from the unrounded schedule the lib uses.
  assert.ok(Math.abs(s.expectedAnnualContributionUsd - income * (appPct / 100)) <= 25);
  assert.ok(Math.abs(s.aptcAnnualUsd - Math.max(0, 6000 - s.expectedAnnualContributionUsd)) <= 0.5);
});

test("CSR is Silver-only and band-gated at the FPL boundaries", () => {
  assert.equal(csrFor(150, "Silver", P)?.variant, "94");
  assert.equal(csrFor(200, "Silver", P)?.variant, "87");
  assert.equal(csrFor(250, "Silver", P)?.variant, "73");
  assert.equal(csrFor(251, "Silver", P), undefined);
  assert.equal(csrFor(180, "Bronze", P), undefined);
});

test("subsidy result always carries the verify-pending provenance note", () => {
  assert.ok(sub(25000).notes.some((n) => /verify/i.test(n)));
});
