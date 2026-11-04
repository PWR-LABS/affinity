/**
 * eval:tic-reconcile — the commercial-layer gate (S5): TiC index answers fuse with other sources
 * through the N-way reconciler under doctrine rules.
 *
 * Deterministic (no network, no database): builds TiC answers via the pure adapter core and
 * reconciles them against Marketplace-API answers, asserting the answer key:
 *   1. corroboration compounds toward — and never exceeds — the 0.95 cap;
 *   2. a conflict collapses confidence and is surfaced, never outvoted by a majority;
 *   3. a plan missing from the index yields "unknown", which never votes;
 *   4. partial-index absence cannot corroborate an API "no".
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

// 2. Unproven absence cannot manufacture a conflict against a positive source.
{
  const tic = buildTicAnswer({ npi: "2", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "2", planId: "EIN:121234567", answers: [api("yes"), tic] });
  check("partial-index absence does not vote against API yes", tic.value === "unknown" && r.verdict === "SINGLE_SOURCE" && r.knownCount === 1);
}

// 3. Plan not indexed → unknown, which never votes: API alone remains SINGLE_SOURCE.
{
  const tic = buildTicAnswer({ npi: "3", planIndexed: false, matchedFiles: [], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "3", planId: "EIN:999999999", answers: [api("yes"), tic] });
  check("unindexed plan yields unknown and does not vote", tic.value === "unknown" && r.verdict === "SINGLE_SOURCE" && r.knownCount === 1, `got ${r.verdict}`);
}

// 4. Nor may an unproven absence falsely corroborate a negative source.
{
  const tic = buildTicAnswer({ npi: "4", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  const r = reconcileMany({ kind: "PROVIDER", subjectKey: "4", planId: "EIN:121234567", answers: [api("no"), tic] });
  check("partial-index absence does not boost API no", r.verdict === "SINGLE_SOURCE" && r.knownCount === 1 && r.reconciledConfidence === reconcileMany({ kind: "PROVIDER", subjectKey: "4", planId: "EIN:121234567", answers: [api("no")] }).reconciledConfidence);
}

// 5. Three-way: add the QHP MRF — cap holds; a dissenting third collapses everything.
{
  const mrf = makeCoverageAnswer({ value: "yes", source: "ISSUER_MRF", fetchedAt: NOW });
  const ticYes = buildTicAnswer({ npi: "5", planIndexed: true, matchedFiles: [FRESH_FILE], fetchedAt: NOW });
  const agree = reconcileMany({ kind: "PROVIDER", subjectKey: "5", planId: "P", answers: [api("yes"), mrf, ticYes] });
  check("three-way agreement caps at 0.95 exactly", agree.verdict === "AGREE" && agree.reconciledConfidence === 0.95, `got ${agree.reconciledConfidence}`);

  const ticNo = buildTicAnswer({ npi: "6", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  const clash = reconcileMany({ kind: "PROVIDER", subjectKey: "6", planId: "P", answers: [api("yes"), makeCoverageAnswer({ value: "no", source: "ISSUER_MRF", fetchedAt: NOW }), ticNo] });
  check("real API/MRF conflict remains; unproven TiC absence does not vote", clash.verdict === "CONFLICT" && clash.consensus === "unknown" && !clash.votes.no.includes("ISSUER_TIC_MRF"), `got ${clash.verdict}`);
}

if (failures > 0) {
  console.log(`\n✗ eval:tic-reconcile FAILED (${failures} check(s))\n`);
  process.exit(1);
}
console.log("\n✓ eval:tic-reconcile PASSED\n");
