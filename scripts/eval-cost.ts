/**
 * eval:cost — the M2 gate (true-cost engine).
 *
 * Property/invariant-based, so there are no brittle magic numbers: it validates the subsidy math
 * (the §36B / KFF formula + interpolation + the 2026 cliff/floor), the OOP-max cap, the Silver-only CSR
 * rule, additivity of the cost breakdown, and the ascending true-cost ranking. The headline proof is
 * the doctrine itself: the plan with the LOWEST premium is shown to NOT be the lowest true cost.
 *
 * LIVE note: when MARKETPLACE_API_KEY is set, the live Marketplace API APTC/CSR is authoritative and
 * supersedes the placeholder policy constants; this gate proves the mechanics either way. Exit 0/1.
 */
import {
  applicablePercent,
  csrFor,
  fplPercent,
  POLICY_2026,
} from "@/lib/cost/policy";
import { computeSubsidy } from "@/lib/cost/subsidy";
import { rankByTrueCost, trueAnnualCost } from "@/lib/cost/engine";
import type { DrugCostInput, PlanCostInputs, UtilizationProfile } from "@/lib/cost/types";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function near(a: number, b: number, tol = 0.02): boolean {
  return Math.abs(a - b) <= tol;
}

const P = POLICY_2026;

// ── A. Applicable-percentage interpolation (exact at anchors + a clean midpoint) ──────────────
check("interp@150=4.14", applicablePercent(150, P) === 4.14, `${applicablePercent(150, P)}`);
check("interp@200=6.52", applicablePercent(200, P) === 6.52, `${applicablePercent(200, P)}`);
check("interp@250=8.33", applicablePercent(250, P) === 8.33, `${applicablePercent(250, P)}`);
check("interp@175=5.33 (midpoint)", near(applicablePercent(175, P), 5.33), `${applicablePercent(175, P)}`);

// ── B. Eligibility window: Medicaid floor below, 2026 cliff above ─────────────────────────────
const floor = computeSubsidy({ incomeUsd: 10000, householdSize: 1, benchmarkMonthlyPremiumUsd: 500, metalLevel: "Silver" });
check("below-floor → ineligible, aptc 0", floor.eligible === false && floor.aptcAnnualUsd === 0, `fpl=${floor.fplPercent}`);
const cliff = computeSubsidy({ incomeUsd: 100000, householdSize: 1, benchmarkMonthlyPremiumUsd: 500, metalLevel: "Silver" });
check("above-cliff (>400%) → ineligible, aptc 0", cliff.eligible === false && cliff.aptcAnnualUsd === 0, `fpl=${cliff.fplPercent}`);

// ── C. Subsidy is monotonic: higher income → lower PTC ────────────────────────────────────────
const lo = computeSubsidy({ incomeUsd: 20000, householdSize: 1, benchmarkMonthlyPremiumUsd: 500, metalLevel: "Silver" });
const hi = computeSubsidy({ incomeUsd: 30000, householdSize: 1, benchmarkMonthlyPremiumUsd: 500, metalLevel: "Silver" });
check("higher income → lower aptc", lo.aptcAnnualUsd > hi.aptcAnnualUsd, `${lo.aptcAnnualUsd} vs ${hi.aptcAnnualUsd}`);

// ── D. Subsidy reproduces the KFF / §36B formula exactly ──────────────────────────────────────
const H = { incomeUsd: 25000, householdSize: 1, benchmarkMonthlyPremiumUsd: 500 };
const sub = computeSubsidy({ ...H, metalLevel: "Silver" });
const fpl = fplPercent(H.incomeUsd, H.householdSize, P);
const appPct = applicablePercent(fpl, P);
const expContribExpected = round2(H.incomeUsd * (appPct / 100));
const benchmarkAnnual = round2(H.benchmarkMonthlyPremiumUsd * 12);
const aptcExpected = Math.max(0, round2(benchmarkAnnual - expContribExpected));
check("expected contribution = income × applicable%", near(sub.expectedAnnualContributionUsd, expContribExpected), `${sub.expectedAnnualContributionUsd} vs ${expContribExpected}`);
check("aptc = benchmark − contribution (floored)", near(sub.aptcAnnualUsd, aptcExpected), `${sub.aptcAnnualUsd} vs ${aptcExpected}`);

// ── E. CSR is Silver-only and band-gated ──────────────────────────────────────────────────────
check("CSR for Silver @160% = 87", sub.csrVariant === "87", `${sub.csrVariant}`);
check("CSR undefined for Bronze", csrFor(160, "Bronze", P) === undefined);
check("CSR undefined for Silver @300% (>250)", csrFor(300, "Silver", P) === undefined);

// ── Plans for the integrated checks (same household H, moderate utilization) ───────────────────
const utilization: UtilizationProfile = { expectedAllowedMedicalUsd: 6000 };
const drug: DrugCostInput = {
  tierMonthlyCopayUsd: { GENERIC: 10, PREFERRED_BRAND: 45 },
  unknownTierMonthlyCopayUsd: 50,
  meds: [
    { rxcui: "617310", tier: "GENERIC", monthlyFills: 1 },
    { rxcui: "999999", tier: "PREFERRED_BRAND", monthlyFills: 1 },
  ],
};
const plans: PlanCostInputs[] = [
  { planId: "SILVER", planLabel: "Silver (CSR 87)", metalLevel: "Silver", premiumUsdMonthly: 480, deductibleUsd: 4000, oopMaxUsd: 8000, coinsuranceRate: 0.3 },
  { planId: "BRONZE", planLabel: "Bronze (lowest premium)", metalLevel: "Bronze", premiumUsdMonthly: 350, deductibleUsd: 7000, oopMaxUsd: 9000, coinsuranceRate: 0.4 },
  { planId: "GOLD", planLabel: "Gold", metalLevel: "Gold", premiumUsdMonthly: 600, deductibleUsd: 1500, oopMaxUsd: 6000, coinsuranceRate: 0.2 },
];

const results = plans.map((plan) => {
  const s = computeSubsidy({ ...H, metalLevel: plan.metalLevel });
  const r = trueAnnualCost(plan, s, utilization, drug, P);
  // Re-derive effective OOP max independently for the cap + additivity invariants.
  const factor = r.csrApplied && s.csrAv !== undefined ? (1 - s.csrAv) / (1 - P.silverBaseAv) : 1;
  const effOopMax = round2(plan.oopMaxUsd * factor);
  return { plan, s, r, effOopMax };
});

for (const { plan, r, effOopMax } of results) {
  // F. Net premium never negative; = max(0, gross − min(gross, aptc)).
  check(`${plan.planId}: net ≥ 0`, r.netAnnualPremiumUsd >= 0, `${r.netAnnualPremiumUsd}`);
  const expectedNet = round2(Math.max(0, r.grossAnnualPremiumUsd - r.aptcAppliedUsd));
  check(`${plan.planId}: net = gross − aptcApplied`, near(r.netAnnualPremiumUsd, expectedNet));
  // G. Member OOP capped at the effective OOP max, which never exceeds the plan OOP max.
  const cappedOOP = Math.min(effOopMax, round2(r.expectedMedicalOOPUsd + r.expectedDrugOOPUsd));
  check(`${plan.planId}: cappedOOP ≤ effOopMax ≤ oopMax`, cappedOOP <= effOopMax + 0.01 && effOopMax <= plan.oopMaxUsd + 0.01);
  // H. Additivity: trueCost = net + cappedOOP.
  check(`${plan.planId}: trueCost = net + cappedOOP`, near(r.trueAnnualCostUsd, round2(r.netAnnualPremiumUsd + cappedOOP)), `${r.trueAnnualCostUsd} vs ${round2(r.netAnnualPremiumUsd + cappedOOP)}`);
  // E (cont.): CSR only applied to Silver.
  if (plan.metalLevel !== "Silver") check(`${plan.planId}: no CSR on non-Silver`, r.csrApplied === false);
}

// ── I. Ranking on TRUE cost, and the doctrine proof: lowest premium ≠ lowest true cost ─────────
const ranked = rankByTrueCost(results.map((x) => x.r));
const ascending = ranked.every((r, i) => i === 0 || ranked[i - 1].trueAnnualCostUsd <= r.trueAnnualCostUsd);
check("ranked ascending by true cost", ascending);

const bronze = results.find((x) => x.plan.planId === "BRONZE")!.r;
const silver = results.find((x) => x.plan.planId === "SILVER")!.r;
check(
  "Bronze has the lowest premium but NOT the lowest true cost",
  bronze.grossAnnualPremiumUsd < silver.grossAnnualPremiumUsd && bronze.trueAnnualCostUsd > silver.trueAnnualCostUsd,
  `premium B=${bronze.grossAnnualPremiumUsd}<S=${silver.grossAnnualPremiumUsd}; trueCost B=${bronze.trueAnnualCostUsd}>S=${silver.trueAnnualCostUsd}`,
);

// ── Report ────────────────────────────────────────────────────────────────────────────────────
console.log("eval:cost — [affinity.] true-cost engine\n");
console.log(`  Household: $${H.incomeUsd}/yr, size ${H.householdSize}, benchmark $${H.benchmarkMonthlyPremiumUsd}/mo`);
console.log(`  Subsidy: FPL ${sub.fplPercent}% · applicable ${sub.applicablePercent}% · APTC $${sub.aptcAnnualUsd}/yr · CSR ${sub.csrVariant ?? "none"}`);
console.log(`\n  Plans ranked by TRUE annual cost (premium in parens — note the order is NOT premium order):`);
for (const r of ranked) {
  console.log(
    `   $${String(Math.round(r.trueAnnualCostUsd)).padStart(5)}  ${r.planLabel}` +
      `  (premium $${Math.round(r.grossAnnualPremiumUsd)}/yr → net $${Math.round(r.netAnnualPremiumUsd)}` +
      ` + OOP med $${Math.round(r.expectedMedicalOOPUsd)} + drug $${Math.round(r.expectedDrugOOPUsd)})`,
  );
}

if (failures.length) {
  console.log(`\n  ✗ FAIL (${failures.length}):`);
  for (const f of failures) console.log(`     - ${f}`);
  console.log("\nFAIL\n");
  process.exit(1);
}
console.log(`\n  ✓ subsidy formula, OOP cap, CSR rules, additivity, and true-cost ranking all hold.`);
console.log("\nPASS\n");
process.exit(0);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
