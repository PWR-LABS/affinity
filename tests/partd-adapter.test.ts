import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPartDAnswer } from "@/lib/partd/adapter";

const NOW = "2026-07-06T12:00:00.000Z";

test("drug on formulary → yes, with tier + the Part D PUF's PA field", () => {
  const { answer, um } = buildPartDAnswer({
    rxcui: "1593856",
    formularyIndexed: true,
    drug: { tier: 3, priorAuthorization: true, stepTherapy: false, quantityLimit: true },
    fetchedAt: NOW,
    sourceLastUpdated: "2026-06-10",
    subjectLabel: "lisdexamfetamine",
  });
  assert.equal(answer.value, "yes");
  assert.equal(answer.provenance.source, "CMS_PARTD");
  assert.equal(answer.formularyTier, "3");
  assert.equal(answer.provenance.sourceLastUpdated, "2026-06-10");
  assert.equal(um.priorAuthorization, true);
  assert.equal(um.quantityLimit, true);
});

test("formulary indexed but drug absent → definite no (not on this plan's list)", () => {
  const { answer, um } = buildPartDAnswer({ rxcui: "999999", formularyIndexed: true, fetchedAt: NOW });
  assert.equal(answer.value, "no");
  assert.deepEqual(um, {});
});

test("plan/formulary not indexed → honest unknown, never a silent no", () => {
  const { answer } = buildPartDAnswer({ rxcui: "1593856", formularyIndexed: false, fetchedAt: NOW });
  assert.equal(answer.value, "unknown");
  assert.ok(answer.confidence <= 0.05);
});
