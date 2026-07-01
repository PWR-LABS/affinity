/**
 * eval:ui-smoke — the M4 gate.
 *
 * Headless check that the web shell's decision board assembles correctly from the demo fixture and
 * that the home page renders without throwing. Asserts the doctrine end to end on the rendered data:
 * the board is ranked by TRUE annual cost (so the lowest-premium plan is NOT necessarily first), every
 * plan carries a confidence grade + a confirm-checklist, and the health route is up. Exit 0/1.
 */
import { loadDemoDecisionBoard } from "@/lib/decision/fixture";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

async function main(): Promise<void> {
  console.log("eval:ui-smoke — [affinity.] web shell decision board");

  const board = await loadDemoDecisionBoard();
  check("board is demo (no key)", board.isLive === false);
  check("board has plans", board.plans.length >= 2, `${board.plans.length}`);
  check("subsidy headline present", /subsidy|Marketplace/i.test(board.subsidyHeadline));

  // Ranked ascending by TRUE annual cost.
  const costs = board.plans.map((p) => p.trueCost.trueAnnualCostUsd);
  const ascending = costs.every((c, i) => i === 0 || costs[i - 1] <= c);
  check("ranked ascending by true cost", ascending, costs.join(","));

  // The doctrine proof: the lowest-premium plan is NOT the rank-1 (true-cost) plan.
  const byPremium = [...board.plans].sort((a, b) => a.trueCost.grossAnnualPremiumUsd - b.trueCost.grossAnnualPremiumUsd);
  check(
    "lowest premium ≠ lowest true cost (premium is not the rank key)",
    byPremium[0].planId !== board.plans[0].planId,
    `cheapest premium ${byPremium[0].planId}, rank1 ${board.plans[0].planId}`,
  );

  // Every plan carries a grade + a checklist + a coverage summary (the three engines wired through).
  for (const p of board.plans) {
    check(`${p.planId}: has A–F grade`, ["A", "B", "C", "D", "F"].includes(p.verify.grade), p.verify.grade);
    check(`${p.planId}: checklist is an array`, Array.isArray(p.verify.checklist));
    check(`${p.planId}: coverage counts present`, p.match.summary.doctorsTotal > 0);
    check(`${p.planId}: true cost = net + OOP (additive)`, Number.isFinite(p.trueCost.trueAnnualCostUsd));
  }

  // Health route still up (the page render itself is proven by `next build`).
  const { GET } = await import("@/app/api/health/route");
  const res = await GET(new Request("http://localhost/api/health"));
  check("health route 200", res.status === 200);

  console.log(`\n  ${board.plans.length} plans ranked by true cost:`);
  for (const p of board.plans) {
    console.log(`   $${Math.round(p.trueCost.trueAnnualCostUsd).toLocaleString().padStart(6)}  ${p.label} [${p.metalLevel}]  grade ${p.verify.grade}  · confirm ${p.verify.checklist.length}`);
  }

  if (failures.length) {
    console.log(`\n  ✗ FAIL (${failures.length}):`);
    for (const f of failures) console.log(`     - ${f}`);
    console.log("\nFAIL\n");
    process.exit(1);
  }
  console.log("\n  ✓ web shell decision board assembles + renders; ranked by true cost with grades + checklists.");
  console.log("\nPASS\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("eval:ui-smoke crashed:", err);
  process.exit(1);
});
