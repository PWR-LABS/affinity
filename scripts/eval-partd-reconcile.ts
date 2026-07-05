/**
 * eval:partd-reconcile — the Medicare segment gate: Part D formulary answers fuse with other sources
 * through the N-way reconciler, and the PA flag the Marketplace API withholds is preserved.
 * Deterministic (no network, no DB). Exit code is the gate: 0 pass, 1 fail.
 */
import { buildPartDAnswer } from "@/lib/partd/adapter";
import { makeCoverageAnswer } from "@/lib/provenance";
import { reconcileMany } from "@/lib/reconcile";

const NOW = "2026-07-06T12:00:00.000Z";
let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

console.log("eval:partd-reconcile — CMS Part D formulary through the N-way reconciler\n");

// 1. Marketplace 'covered' ∪ Part D 'on formulary' → agreement compounds.
{
  const api = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: NOW });
  const { answer: partd, um } = buildPartDAnswer({ rxcui: "1593856", formularyIndexed: true, drug: { tier: 3, priorAuthorization: true }, fetchedAt: NOW, sourceLastUpdated: "2026-06-10" });
  const r = reconcileMany({ kind: "DRUG", subjectKey: "1593856", planId: "S1234-001", answers: [api, partd] });
  check("API∪PartD agreement compounds above either alone", r.verdict === "AGREE" && r.reconciledConfidence > Math.max(api.confidence, partd.confidence), `${r.verdict} @ ${r.reconciledConfidence}`);
  check("the PA flag the Marketplace hides is preserved by Part D", um.priorAuthorization === true);
}

// 2. Part D 'not on formulary' vs API 'covered' → CONFLICT, collapsed, surfaced.
{
  const api = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: NOW });
  const { answer: partd } = buildPartDAnswer({ rxcui: "999", formularyIndexed: true, fetchedAt: NOW });
  const r = reconcileMany({ kind: "DRUG", subjectKey: "999", planId: "S1234-001", answers: [api, partd] });
  check("API-covered vs PartD-not-on-formulary is a CONFLICT", r.verdict === "CONFLICT" && r.consensus === "unknown", r.verdict);
}

// 3. Plan not in the Part D index → unknown, never votes.
{
  const { answer: partd } = buildPartDAnswer({ rxcui: "1593856", formularyIndexed: false, fetchedAt: NOW });
  const api = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: NOW });
  const r = reconcileMany({ kind: "DRUG", subjectKey: "1593856", planId: "P", answers: [api, partd] });
  check("unindexed Part D plan yields unknown and does not vote", partd.value === "unknown" && r.verdict === "SINGLE_SOURCE", r.verdict);
}

if (failures > 0) {
  console.log(`\n✗ eval:partd-reconcile FAILED (${failures} check(s))\n`);
  process.exit(1);
}
console.log("\n✓ eval:partd-reconcile PASSED\n");
