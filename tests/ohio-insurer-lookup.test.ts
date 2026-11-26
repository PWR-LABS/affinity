import assert from "node:assert/strict";
import test from "node:test";

import { findOhioCoverageResources } from "../src/lib/insurers/ohio-insurers";

test("Ohio insurer lookup recognizes aliases and returns official handoffs", () => {
  assert.deepEqual(findOhioCoverageResources("care source").map(row => row.name), ["CareSource"]);
  assert.deepEqual(findOhioCoverageResources("BCBS").map(row => row.name), ["Anthem Blue Cross and Blue Shield"]);
  assert.ok(findOhioCoverageResources("medicare").some(row => row.name === "Medicare.gov account"));
  assert.deepEqual(findOhioCoverageResources("unlisted plan"), []);
  assert.equal(findOhioCoverageResources("").length, 10);
  assert.ok(findOhioCoverageResources("").every(row => new URL(row.href).protocol === "https:"));
});
