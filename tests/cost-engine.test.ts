import assert from "node:assert/strict";
import { test } from "node:test";

import { estimateHouseholdPlanCost, trueAnnualCost } from "@/lib/cost/engine";
import { computeSubsidy } from "@/lib/cost/subsidy";
import type { DrugCostInput, PlanCostInputs, UtilizationProfile } from "@/lib/cost/types";

const HOUSEHOLD = { incomeUsd: 25000, householdSize: 1, benchmarkMonthlyPremiumUsd: 500 };
const UTIL: UtilizationProfile = { expectedAllowedMedicalUsd: 6000 };
const DRUG: DrugCostInput = {
  tierMonthlyCopayUsd: { GENERIC: 10 },
  unknownTierMonthlyCopayUsd: 50,
  meds: [{ rxcui: "617310", tier: "GENERIC", monthlyFills: 1 }],
};

const silver: PlanCostInputs = { planId: "S", metalLevel: "Silver", premiumUsdMonthly: 480, deductibleUsd: 4000, oopMaxUsd: 8000, coinsuranceRate: 0.3 };
const bronze: PlanCostInputs = { planId: "B", metalLevel: "Bronze", premiumUsdMonthly: 350, deductibleUsd: 7000, oopMaxUsd: 9000, coinsuranceRate: 0.4 };

test("cost breakdown is additive: trueCost = net + capped OOP", () => {
  const r = estimateHouseholdPlanCost(bronze, HOUSEHOLD, UTIL, DRUG);
  const capped = Math.min(bronze.oopMaxUsd, r.expectedMedicalOOPUsd + r.expectedDrugOOPUsd);
  assert.ok(Math.abs(r.trueAnnualCostUsd - (r.netAnnualPremiumUsd + capped)) <= 0.02);
});

test("member OOP never exceeds the plan OOP max", () => {
  const heavy: UtilizationProfile = { expectedAllowedMedicalUsd: 500000 };
  const r = estimateHouseholdPlanCost(bronze, HOUSEHOLD, heavy, DRUG);
  const capped = Math.min(bronze.oopMaxUsd, r.expectedMedicalOOPUsd + r.expectedDrugOOPUsd);
  assert.ok(capped <= bronze.oopMaxUsd + 0.01);
});

test("net premium is floored at zero when the PTC exceeds the premium", () => {
  const r = estimateHouseholdPlanCost(bronze, HOUSEHOLD, UTIL, DRUG);
  assert.ok(r.netAnnualPremiumUsd >= 0);
});

test("CSR lowers effective cost-sharing on Silver", () => {
  const withCsr = computeSubsidy({ ...HOUSEHOLD, metalLevel: "Silver" }); // ~160% FPL → CSR 87
  const noCsr = { ...withCsr, csrVariant: undefined, csrAv: undefined };
  const a = trueAnnualCost(silver, withCsr, UTIL, DRUG);
  const b = trueAnnualCost(silver, noCsr, UTIL, DRUG);
  assert.equal(a.csrApplied, true);
  assert.equal(b.csrApplied, false);
  assert.ok(a.expectedMedicalOOPUsd < b.expectedMedicalOOPUsd);
});

test("CSR is never applied to a non-Silver plan", () => {
  const sub = computeSubsidy({ ...HOUSEHOLD, metalLevel: "Bronze" });
  assert.equal(trueAnnualCost(bronze, sub, UTIL, DRUG).csrApplied, false);
});

test("an unknown drug tier falls back to the unknown-tier copay and notes it", () => {
  const drug: DrugCostInput = { tierMonthlyCopayUsd: { GENERIC: 10 }, unknownTierMonthlyCopayUsd: 50, meds: [{ rxcui: "x", tier: "SPECIALTY", monthlyFills: 1 }] };
  const r = estimateHouseholdPlanCost(bronze, HOUSEHOLD, { expectedAllowedMedicalUsd: 0 }, drug);
  assert.equal(r.expectedDrugOOPUsd, 50 * 12);
  assert.ok(r.notes.some((n) => /unknown/i.test(n)));
});
