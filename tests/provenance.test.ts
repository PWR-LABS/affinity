import assert from "node:assert/strict";
import { test } from "node:test";

import { BASE_CONFIDENCE, makeCoverageAnswer, needsConfirmation, renderCoverageAnswer } from "@/lib/provenance";

const FETCH = "2026-06-17T12:00:00.000Z";

test("fresh API 'yes' carries the source's base confidence", () => {
  const a = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: FETCH });
  assert.equal(a.confidence, BASE_CONFIDENCE.MARKETPLACE_API);
});

test("'unknown' is near-zero confidence regardless of source", () => {
  const a = makeCoverageAnswer({ value: "unknown", source: "ISSUER_MRF", fetchedAt: FETCH });
  assert.ok(a.confidence <= 0.05, `${a.confidence}`);
});

test("stale source data decays confidence below fresh", () => {
  const fresh = makeCoverageAnswer({ value: "yes", source: "ISSUER_MRF", fetchedAt: FETCH, sourceLastUpdated: "2026-06-17" });
  const stale = makeCoverageAnswer({ value: "yes", source: "ISSUER_MRF", fetchedAt: FETCH, sourceLastUpdated: "2024-06-17" });
  assert.ok(stale.confidence < fresh.confidence, `${stale.confidence} !< ${fresh.confidence}`);
});

test("render never emits a bare claim — always names the source + confidence", () => {
  const a = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: FETCH, subjectLabel: "Dr. X" });
  const s = renderCoverageAnswer(a);
  assert.match(s, /per the Marketplace API/);
  assert.match(s, /confidence/);
});

test("render of 'unknown' says unknown and asks to confirm", () => {
  const a = makeCoverageAnswer({ value: "unknown", source: "ISSUER_MRF", fetchedAt: FETCH });
  const s = renderCoverageAnswer(a);
  assert.match(s, /unknown/i);
  assert.match(s, /confirm/i);
});

test("a conflicted claim renders the conflict and a confirm prompt", () => {
  const a = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: FETCH, confidence: 0.9 });
  a.conflictsWith = ["ISSUER_MRF"];
  const s = renderCoverageAnswer(a);
  assert.match(s, /conflicts with/i);
  assert.match(s, /confirm/i);
});

test("needsConfirmation: unknown / conflict / low-confidence require it; clean high-confidence does not", () => {
  assert.equal(needsConfirmation(makeCoverageAnswer({ value: "unknown", source: "ISSUER_MRF", fetchedAt: FETCH })), true);
  const conf = makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: FETCH, confidence: 0.9 });
  conf.conflictsWith = ["ISSUER_MRF"];
  assert.equal(needsConfirmation(conf), true);
  assert.equal(needsConfirmation(makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: FETCH, confidence: 0.5 })), true);
  assert.equal(needsConfirmation(makeCoverageAnswer({ value: "yes", source: "MARKETPLACE_API", fetchedAt: FETCH, confidence: 0.9 })), false);
});
