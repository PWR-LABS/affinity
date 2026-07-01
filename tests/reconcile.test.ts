import assert from "node:assert/strict";
import { test } from "node:test";

import { makeCoverageAnswer, type Tristate } from "@/lib/provenance";
import { reconcileClaim, summarize } from "@/lib/reconcile";

const FETCH = "2026-06-17T12:00:00.000Z";

function claim(apiVal: Tristate, mrfVal: Tristate) {
  const api = makeCoverageAnswer({ value: apiVal, source: "MARKETPLACE_API", fetchedAt: FETCH, confidence: 0.6 });
  const mrf = makeCoverageAnswer({ value: mrfVal, source: "ISSUER_MRF", fetchedAt: FETCH, confidence: 0.6 });
  return reconcileClaim({ kind: "PROVIDER", subjectKey: "1", planId: "P", api, mrf });
}

test("AGREE boosts confidence above either source and stamps the counterpart", () => {
  const r = claim("yes", "yes");
  assert.equal(r.verdict, "AGREE");
  assert.ok(r.reconciledConfidence > 0.6);
  assert.deepEqual(r.api.agreesWith, ["ISSUER_MRF"]);
  assert.deepEqual(r.mrf.agreesWith, ["MARKETPLACE_API"]);
});

test("CONFLICT halves confidence and flags both answers", () => {
  const r = claim("yes", "no");
  assert.equal(r.verdict, "CONFLICT");
  assert.ok(r.reconciledConfidence < 0.6);
  assert.deepEqual(r.api.conflictsWith, ["ISSUER_MRF"]);
  assert.deepEqual(r.mrf.conflictsWith, ["MARKETPLACE_API"]);
});

test("API_ONLY / MRF_ONLY when one side is silent", () => {
  assert.equal(claim("yes", "unknown").verdict, "API_ONLY");
  assert.equal(claim("unknown", "yes").verdict, "MRF_ONLY");
});

test("BOTH_UNKNOWN collapses to near-zero confidence", () => {
  const r = claim("unknown", "unknown");
  assert.equal(r.verdict, "BOTH_UNKNOWN");
  assert.ok(r.reconciledConfidence <= 0.05);
});

test("summarize counts verdicts and the agreement rate among comparable pairs", () => {
  const s = summarize([claim("yes", "yes"), claim("yes", "no"), claim("yes", "unknown"), claim("unknown", "unknown")]);
  assert.equal(s.total, 4);
  assert.equal(s.agree, 1);
  assert.equal(s.conflict, 1);
  assert.equal(s.apiOnly, 1);
  assert.equal(s.bothUnknown, 1);
  assert.equal(s.agreementRateAmongComparable, 0.5); // 1 agree of (1 agree + 1 conflict)
});

test("agreement rate is null when nothing is comparable", () => {
  assert.equal(summarize([claim("unknown", "unknown")]).agreementRateAmongComparable, null);
});
