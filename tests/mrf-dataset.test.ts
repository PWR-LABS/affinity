import assert from "node:assert/strict";
import { test } from "node:test";

import { datasetFromRecords } from "@/lib/mrf/client";
import type { MrfProvider } from "@/lib/mrf/types";

const FETCH = "2026-06-17T12:00:00.000Z";

test("provider honesty rules: present+listed→yes, present+unlisted→no, absent→unknown", () => {
  const ds = datasetFromRecords(
    [{ npi: "1", plans: [{ plan_id: "P" }], last_updated_on: "2026-06-17" }],
    [],
    FETCH,
  );
  assert.equal(ds.providerAnswer("1", "P").value, "yes");
  assert.equal(ds.providerAnswer("1", "OTHER").value, "no");
  assert.equal(ds.providerAnswer("999", "P").value, "unknown");
});

test("drug match surfaces the formulary tier", () => {
  const ds = datasetFromRecords(
    [],
    [{ rxnorm_id: "617310", plans: [{ plan_id: "P", drug_tier: "GENERIC" }] }],
    FETCH,
  );
  const a = ds.drugAnswer("617310", "P");
  assert.equal(a.value, "yes");
  assert.equal(a.formularyTier, "GENERIC");
});

test("malformed 'plans' (not an array) is tolerated, not thrown", () => {
  const bad = [{ npi: "1", plans: "oops" as unknown as MrfProvider["plans"] }];
  const ds = datasetFromRecords(bad as MrfProvider[], [], FETCH);
  assert.equal(ds.providerAnswer("1", "P").value, "no"); // no listed plans, but record exists
});

test("numeric / whitespace-padded keys are normalized on both sides", () => {
  const ds = datasetFromRecords(
    [{ npi: 12345 as unknown as string, plans: [{ plan_id: "P" }] }],
    [],
    FETCH,
  );
  assert.equal(ds.providerAnswer(" 12345 ", "P").value, "yes");
  assert.equal(ds.providerCount, 1);
});

test("null / keyless junk records are skipped", () => {
  const junk = [null, 7, { name: "no npi" }, { npi: "1", plans: [] }] as unknown as MrfProvider[];
  const ds = datasetFromRecords(junk, [], FETCH);
  assert.equal(ds.providerCount, 1);
  assert.equal(ds.providerAnswer("1", "P").value, "no");
});

test("MRF answers always carry ISSUER_MRF provenance + the file freshness", () => {
  const ds = datasetFromRecords([{ npi: "1", plans: [{ plan_id: "P" }], last_updated_on: "2026-05-01" }], [], FETCH);
  const a = ds.providerAnswer("1", "P");
  assert.equal(a.provenance.source, "ISSUER_MRF");
  assert.equal(a.provenance.sourceLastUpdated, "2026-05-01");
});
