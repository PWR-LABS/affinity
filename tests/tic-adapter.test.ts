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
  assert.equal(a.provenance.sourceUrl, "https://x/f2.json.gz");
  assert.ok(a.confidence > 0.5, "fresh issuer file should carry its base confidence");
});

test("plan indexed but NPI absent → unknown without completeness evidence", () => {
  const a = buildTicAnswer({ npi: "1093712345", planIndexed: true, matchedFiles: [], fetchedAt: NOW });
  assert.equal(a.value, "unknown");
  assert.equal(a.evidenceStatus, "incomplete_index");
});

test("plan not in the index → honest unknown, never a silent no", () => {
  const a = buildTicAnswer({ npi: "1093712345", planIndexed: false, matchedFiles: [], fetchedAt: NOW });
  assert.equal(a.value, "unknown");
  assert.ok(a.confidence <= 0.05);
});

for (const [date, status] of [
  ["2026-01-01T00:00:00Z", "source_stale"],
  [undefined, "source_date_unknown"],
  ["broken", "source_date_unknown"],
  ["2027-01-01T00:00:00Z", "source_date_unknown"],
] as const) {
  for (const matched of [true, false]) {
    test(`withhold ${matched ? "match" : "absence"} with ${date} source date`, () => {
      const files = [{ url: "https://example.com/file", sourceLastUpdated: date }];
      const answer = buildTicAnswer({ npi: "1", planIndexed: true, matchedFiles: matched ? files : [], indexedFiles: files, fetchedAt: NOW });
      assert.equal(answer.value, "unknown");
      assert.equal(answer.evidenceStatus, status);
      assert.equal(answer.provenance.sourceUrl, files[0].url);
    });
  }
}
test("60-day boundary is inclusive; a future date cannot win over a current match", () => {
  const file = { url: "https://example.com/current", sourceLastUpdated: new Date(Date.parse(NOW) - 60 * 86400000).toISOString() };
  const args = { npi: "1", planIndexed: true, fetchedAt: NOW, matchedFiles: [file, { url: "https://example.com/future", sourceLastUpdated: "2099-01-01" }] };
  assert.equal(buildTicAnswer(args).value, "yes");
  assert.equal(buildTicAnswer(args).provenance.sourceUrl, file.url);
  assert.equal(buildTicAnswer({ ...args, fetchedAt: new Date(Date.parse(NOW) + 1).toISOString() }).value, "unknown");
});
