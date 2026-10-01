import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FEATURED_MEDICAID_CHANGES,
  STATE_MEDICAID_RESOURCES,
  featuredMedicaidChange,
  medicaidChangeUrl,
  medicaidResourceByCode,
} from "@/lib/medicaid/states";
import { FEDERAL_MEDICAID_CHANGES, MEDICAID_GUIDANCE_REVIEWED } from "@/lib/medicaid/federal";

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
  assert.equal(medicaidResourceByCode("CA")?.applyUrl, "https://www.dhcs.ca.gov/medi-cal/apply/");
  assert.equal(medicaidResourceByCode("AL")?.phone, "800-362-1504");
  assert.equal(medicaidResourceByCode("DC")?.phone, "202-727-5355");
  assert.equal(medicaidResourceByCode("XX"), undefined);
  assert.equal(medicaidChangeUrl("ca"), "https://www.medicaid.gov/renew-info/CA");
});

test("New York and Ohio have dated, source-backed state watches", () => {
  assert.deepEqual(FEATURED_MEDICAID_CHANGES.map((change) => change.code), ["NY", "OH"]);
  assert.ok(featuredMedicaidChange("NY")?.sources.some((source) => source.url.startsWith("https://www.health.ny.gov/")));
  assert.ok(featuredMedicaidChange("oh")?.sources.some((source) => source.url.startsWith("https://codes.ohio.gov/")));
  assert.equal(featuredMedicaidChange("CA"), undefined);
});

test("the two federal changes have separate scope, timing, and official sources", () => {
  assert.equal(MEDICAID_GUIDANCE_REVIEWED, "September 28, 2026");
  assert.deepEqual(FEDERAL_MEDICAID_CHANGES.map((change) => change.id), ["renewals", "community-engagement"]);
  assert.match(FEDERAL_MEDICAID_CHANGES[0].summary, /adult expansion group/);
  assert.match(FEDERAL_MEDICAID_CHANGES[1].summary, /Some adults/);
  for (const change of FEDERAL_MEDICAID_CHANGES) {
    assert.match(change.sourceUrl, /^https:\/\//);
    assert.match(change.kicker, /2027/);
  }
});
