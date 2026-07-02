/**
 * eval:tic-reconcile — the commercial-layer gate (S5): TiC index answers fuse with other sources
 * through the N-way reconciler under doctrine rules.
 *
 * Deterministic (no network, no database): builds TiC answers via the pure adapter core and
 * reconciles them against Marketplace-API answers, asserting the answer key:
 *   1. corroboration compounds toward — and never exceeds — the 0.95 cap;
 *   2. a conflict collapses confidence and is surfaced, never outvoted by a majority;
 *   3. a plan missing from the index yields "unknown", which never votes;
 *   4. plan-indexed-but-NPI-absent is a definite "no" that can corroborate an API "no".
 * Exit code is the gate: 0 pass, 1 fail.
 */
import { makeCoverageAnswer } from "@/lib/provenance";
import { reconcileMany } from "@/lib/reconcile";
import { buildTicAnswer } from "@/lib/tic/adapter";

const NOW = "2026-07-02T12:00:00.000Z";
const FRESH_FILE = { url: "https://issuer.example/in-network.json.gz", sourceLastUpdated: "2026-07-01T00:00:00.000Z" };

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function api(value: "yes" | "no" | "unknown") {
  return makeCoverageAnswer({ value, source: "MARKETPLACE_API", fetchedAt: NOW });
}

console.log("eval:tic-reconcile — commercial TiC answers through the N-way reconciler\n");

// 1. AGREE: API yes + TiC yes → compounds, capped below certainty.
{
  const tic = buildTicAnswer({ npi: "1", planIndexed: true, matchedFiles: [FRESH_FILE], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "1", planId: "EIN:121234567", answers: [api("yes"), tic] });
  check("API∪TiC agreement compounds (+0.2 over the stronger source)", r.verdict === "AGREE" && r.reconciledConfidence > Math.max(0.55, tic.confidence), `got ${r.verdict} @ ${r.reconciledConfidence}`);
  check("agreement never reaches certainty (≤0.95)", r.reconciledConfidence <= 0.95);
}

// 2. CONFLICT: API yes + TiC definite-no → collapse + surfaced, consensus stays unknown.
{
  const tic = buildTicAnswer({ npi: "2", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "2", planId: "EIN:121234567", answers: [api("yes"), tic] });
  check("API-yes vs TiC-no is a CONFLICT with collapsed confidence", r.verdict === "CONFLICT" && r.reconciledConfidence < 0.3, `got ${r.verdict} @ ${r.reconciledConfidence}`);
  check("conflict is never silently resolved (consensus unknown)", r.consensus === "unknown");
  check("the conflict is stamped onto both answers", (r.answers[0].conflictsWith?.length ?? 0) > 0 && (r.answers[1].conflictsWith?.length ?? 0) > 0);
}

// 3. Plan not indexed → unknown, which never votes: API alone remains SINGLE_SOURCE.
{
  const tic = buildTicAnswer({ npi: "3", planIndexed: false, matchedFiles: [], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "3", planId: "EIN:999999999", answers: [api("yes"), tic] });
  check("unindexed plan yields unknown and does not vote", tic.value === "unknown" && r.verdict === "SINGLE_SOURCE" && r.knownCount === 1, `got ${r.verdict}`);
}

// 4. Corroborated absence: API no + TiC no agree — a trustworthy "not in-network" is also a product answer.
{
  const tic = buildTicAnswer({ npi: "4", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "4", planId: "EIN:121234567", answers: [api("no"), tic] });
  check("corroborated 'no' agrees and compounds", r.verdict === "AGREE" && r.consensus === "no" && r.reconciledConfidence > tic.confidence, `got ${r.verdict} @ ${r.reconciledConfidence}`);
}

// 5. Three-way: add the QHP MRF — cap holds; a dissenting third collapses everything.
{
  const mrf = makeCoverageAnswer({ value: "yes", source: "ISSUER_MRF", fetchedAt: NOW });
  const ticYes = buildTicAnswer({ npi: "5", planIndexed: true, matchedFiles: [FRESH_FILE], fetchedAt: NOW });
  const agree = reconcileMany({ kind: "PROVIDER", subjectKey: "5", planId: "P", answers: [api("yes"), mrf, ticYes] });
  check("three-way agreement caps at 0.95 exactly", agree.verdict === "AGREE" && agree.reconciledConfidence === 0.95, `got ${agree.reconciledConfidence}`);

  const ticNo = buildTicAnswer({ npi: "6", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  const clash = reconcileMany({ kind: "PROVIDER", subjectKey: "6", planId: "P", answers: [api("yes"), makeCoverageAnswer({ value: "yes", source: "ISSUER_MRF", fetchedAt: NOW }), ticNo] });
  check("2-vs-1 still collapses (majority never wins a conflict)", clash.verdict === "CONFLICT" && clash.consensus === "unknown" && clash.votes.no.includes("ISSUER_TIC_MRF"), `got ${clash.verdict}`);
}

if (failures > 0) {
  console.log(`\n✗ eval:tic-reconcile FAILED (${failures} check(s))\n`);
  process.exit(1);
}
console.log("\n✓ eval:tic-reconcile PASSED\n");
