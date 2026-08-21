import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FEATURED_MEDICAID_CHANGES,
  STATE_MEDICAID_RESOURCES,
  featuredMedicaidChange,
  medicaidChangeUrl,
  medicaidResourceByCode,
} from "@/lib/medicaid/states";

test("covers all 50 states plus the District of Columbia exactly once", () => {
  assert.equal(STATE_MEDICAID_RESOURCES.length, 51);
  const codes = new Set(STATE_MEDICAID_RESOURCES.map((resource) => resource.code));
  assert.equal(codes.size, 51);
  assert.ok(codes.has("DC"));
  assert.ok(codes.has("NY"));
  assert.ok(codes.has("OH"));
});

test("every state has an official secure entry point and phone number", () => {
  for (const resource of STATE_MEDICAID_RESOURCES) {
    assert.match(resource.code, /^[A-Z]{2}$/);
    assert.match(resource.applyUrl, /^https:\/\//, `${resource.code} needs an HTTPS state link`);
    assert.match(resource.phone, /\d{3}/, `${resource.code} needs a phone number`);
  }
});

test("state lookup and CMS change guides are case-insensitive", () => {
  assert.equal(medicaidResourceByCode("ny")?.program, "New York State Medicaid");
  assert.equal(medicaidResourceByCode("oh")?.phone, "800-324-8680");
  assert.equal(medicaidResourceByCode("XX"), undefined);
  assert.equal(medicaidChangeUrl("ca"), "https://www.medicaid.gov/renew-info/CA");
});

test("New York and Ohio have dated, source-backed state watches", () => {
  assert.deepEqual(FEATURED_MEDICAID_CHANGES.map((change) => change.code), ["NY", "OH"]);
  assert.match(featuredMedicaidChange("NY")?.sourceUrl ?? "", /^https:\/\/www\.health\.ny\.gov\//);
  assert.match(featuredMedicaidChange("oh")?.sourceUrl ?? "", /^https:\/\/codes\.ohio\.gov\//);
  assert.equal(featuredMedicaidChange("CA"), undefined);
});
