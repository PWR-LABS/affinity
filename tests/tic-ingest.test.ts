import assert from "node:assert/strict";
import { test } from "node:test";

import {
  groupManifestByFile,
  normalizeEmployerName,
  parseEmployerEinLine,
  parseManifestLine,
  parseMembershipLine,
  splitCsvLine,
} from "@/lib/tic/ingest";

test("splitCsvLine handles quoted commas and doubled quotes", () => {
  assert.deepEqual(splitCsvLine('a,"b, with comma",c'), ["a", "b, with comma", "c"]);
  assert.deepEqual(splitCsvLine('x,"He said ""hi""",z'), ["x", 'He said "hi"', "z"]);
  assert.deepEqual(splitCsvLine("plain,row,here"), ["plain", "row", "here"]);
});

test("parseManifestLine skips the header and parses quoted plan names", () => {
  assert.equal(parseManifestLine("file_url,file_description,plan_name,plan_id_type,plan_id,plan_market_type,reporting_entity"), null);
  const row = parseManifestLine('https://x/f.json.gz,in-network OH,"Sample PPO Gold, Large Group",EIN,121234567,group,Sample Plan');
  assert.ok(row);
  assert.equal(row.planName, "Sample PPO Gold, Large Group");
  assert.equal(row.planIdType, "EIN");
  assert.equal(row.fileUrl, "https://x/f.json.gz");
});

test("parseMembershipLine parses extractor NDJSON and rejects malformed lines", () => {
  const line = '{"npi":"1234567893","tin_type":"ein","tin_value":"111222333","file_url":"https://x/f.json.gz","reporting_entity":"Sample","last_updated_on":"2026-07-01","schema":"v1"}';
  const m = parseMembershipLine(line);
  assert.ok(m);
  assert.equal(m.npi, "1234567893");
  assert.equal(m.schema, "v1");
  assert.equal(parseMembershipLine(""), null);
  assert.equal(parseMembershipLine("not json"), null);
  assert.equal(parseMembershipLine('{"tin_value":"1","file_url":"u"}'), null); // missing npi
});

test("groupManifestByFile dedups identical plan links and keys by file", () => {
  const mk = (planId: string, planName = "P") => ({
    fileUrl: "https://x/f.json.gz", fileDescription: "d", planName, planIdType: "EIN",
    planId, planMarketType: "group", reportingEntity: "Sample",
  });
  const grouped = groupManifestByFile([mk("1"), mk("1"), mk("2"), { ...mk("9"), fileUrl: "https://x/g.json.gz" }]);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get("https://x/f.json.gz")?.plans.length, 2);
  assert.equal(grouped.get("https://x/g.json.gz")?.plans.length, 1);
});

test("normalizeEmployerName matches SPEC-4 suffix stripping for employer search", () => {
  assert.equal(normalizeEmployerName("THE Kroger Co."), "KROGER");
  assert.equal(normalizeEmployerName("Acme Holdings LLC"), "ACME");
  assert.equal(normalizeEmployerName("THE"), "THE");
  assert.equal(normalizeEmployerName("Blue River, Health LLC"), "BLUE RIVER HEALTH");
});

test("parseEmployerEinLine parses SPEC-4 NDJSON and rejects malformed rows", () => {
  const row = parseEmployerEinLine(
    '{"ein":"310675386","name":"THE KROGER CO","name_norm":"KROGER","state":"OH","plan_name":"KROGER HEALTH & WELFARE PLAN","participants":420000,"form":"5500","plan_year":2025}',
  );
  assert.ok(row);
  assert.equal(row.ein, "310675386");
  assert.equal(row.nameNorm, "KROGER");
  assert.equal(row.planName, "KROGER HEALTH & WELFARE PLAN");
  assert.equal(parseEmployerEinLine("not json"), null);
  assert.equal(parseEmployerEinLine('{"ein":"bad","name":"Bad Co"}'), null);
});
