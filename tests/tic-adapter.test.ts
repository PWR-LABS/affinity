import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTicAnswer } from "@/lib/tic/adapter";

const NOW = "2026-07-02T12:00:00.000Z";

test("NPI listed in an indexed file → yes, with the FRESHEST file's date as source freshness", () => {
  const a = buildTicAnswer({
    npi: "1234567893",
    planIndexed: true,
    matchedFiles: [
      { url: "https://x/f1.json.gz", sourceLastUpdated: "2026-06-01T00:00:00.000Z" },
      { url: "https://x/f2.json.gz", sourceLastUpdated: "2026-07-01T00:00:00.000Z" },
    ],
    fetchedAt: NOW,
    subjectLabel: "Dr. Sample (NPI 1234567893)",
  });
  assert.equal(a.value, "yes");
  assert.equal(a.provenance.source, "ISSUER_TIC_MRF");
  assert.equal(a.provenance.sourceLastUpdated, "2026-07-01T00:00:00.000Z");
  assert.equal(a.provenance.sourceUrl, "https://x/f1.json.gz");
  assert.ok(a.confidence > 0.5, "fresh issuer file should carry its base confidence");
});

test("plan indexed but NPI absent → definite no (the issuer's own file omits them)", () => {
  const a = buildTicAnswer({ npi: "1093712345", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  assert.equal(a.value, "no");
});

test("plan not in the index → honest unknown, never a silent no", () => {
  const a = buildTicAnswer({ npi: "1093712345", planIndexed: false, matchedFiles: [], fetchedAt: NOW });
  assert.equal(a.value, "unknown");
  assert.ok(a.confidence <= 0.05);
});
