import assert from "node:assert/strict";
import { test } from "node:test";

import { makeCoverageAnswer, type CoverageAnswer, type SourceTag, type Tristate } from "@/lib/provenance";
import { reconcileMany } from "@/lib/reconcile";

const NOW = "2026-07-02T12:00:00.000Z";

function ans(source: SourceTag, value: Tristate, confidence?: number): CoverageAnswer {
  return makeCoverageAnswer({ value, source, fetchedAt: NOW, confidence });
}

const base = { kind: "PROVIDER" as const, subjectKey: "1234567893", planId: "PLAN1" };

test("three agreeing sources compound confidence and hit the hard cap", () => {
  const r = reconcileMany({ ...base, answers: [ans("MARKETPLACE_API", "yes", 0.55), ans("ISSUER_MRF", "yes", 0.6), ans("ISSUER_TIC_MRF", "yes", 0.6)] });
  assert.equal(r.verdict, "AGREE");
  assert.equal(r.consensus, "yes");
  assert.equal(r.knownCount, 3);
  // max(0.6) + 0.2×2 = 1.0 → capped at 0.95. Three files never equal certainty.
  assert.equal(r.reconciledConfidence, 0.95);
  assert.deepEqual([...r.agreesWith].sort(), ["ISSUER_MRF", "ISSUER_TIC_MRF", "MARKETPLACE_API"]);
  // Each answer is stamped with its two corroborating counterparts.
  assert.equal(r.answers[0].agreesWith?.length, 2);
});

test("two agreeing sources reproduce the M0 +0.2 exactly", () => {
  const r = reconcileMany({ ...base, answers: [ans("MARKETPLACE_API", "yes", 0.55), ans("ISSUER_TIC_MRF", "yes", 0.6)] });
  assert.equal(r.reconciledConfidence, 0.8); // max(0.6) + 0.2
});

test("a 2-vs-1 conflict collapses confidence and is never outvoted", () => {
  const api = ans("MARKETPLACE_API", "yes", 0.55);
  const mrf = ans("ISSUER_MRF", "yes", 0.6);
  const tic = ans("ISSUER_TIC_MRF", "no", 0.6);
  const r = reconcileMany({ ...base, answers: [api, mrf, tic] });
  assert.equal(r.verdict, "CONFLICT");
  assert.equal(r.consensus, "unknown"); // majority does NOT silently win
  assert.equal(r.reconciledConfidence, 0.28); // min(0.55) × 0.5, rounded
  assert.deepEqual(r.votes.yes.sort(), ["ISSUER_MRF", "MARKETPLACE_API"]);
  assert.deepEqual(r.votes.no, ["ISSUER_TIC_MRF"]);
  // Stamps: the yes-answers agree with each other and conflict with the dissenter — and vice versa.
  assert.deepEqual(api.agreesWith, ["ISSUER_MRF"]);
  assert.deepEqual(api.conflictsWith, ["ISSUER_TIC_MRF"]);
  assert.deepEqual(tic.conflictsWith?.sort(), ["ISSUER_MRF", "MARKETPLACE_API"]);
});

test("unknowns never vote: one known source is SINGLE_SOURCE, none is ALL_UNKNOWN", () => {
  const single = reconcileMany({ ...base, answers: [ans("ISSUER_TIC_MRF", "yes", 0.6), ans("MARKETPLACE_API", "unknown")] });
  assert.equal(single.verdict, "SINGLE_SOURCE");
  assert.equal(single.consensus, "yes");
  assert.equal(single.reconciledConfidence, 0.54); // 0.6 × 0.9

  const none = reconcileMany({ ...base, answers: [ans("MARKETPLACE_API", "unknown"), ans("ISSUER_TIC_MRF", "unknown")] });
  assert.equal(none.verdict, "ALL_UNKNOWN");
  assert.equal(none.reconciledConfidence, 0.05);
});
