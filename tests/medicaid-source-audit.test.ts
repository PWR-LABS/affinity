import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCmsEnrollmentLinks, parseCmsListedPhones, sameDestination } from "../scripts/eval-medicaid-handoffs";

test("CMS enrollment extraction stays within each state section", () => {
  const html = '<h3 id="AA">One</h3><a href="https://one.example/apply?x=1&amp;y=2">Enrollment</a>'
    + '<h3 id="BB">Two</h3><a href="https://two.example/other">Eligibility</a>'
    + '<h3 id="CC">Three</h3><a href="https://three.example/">Enrollment</a>';
  const links = parseCmsEnrollmentLinks(html);
  assert.equal(links.get("AA"), "https://one.example/apply?x=1&y=2");
  assert.equal(links.has("BB"), false);
  assert.equal(links.get("CC"), "https://three.example/");
});

test("destination comparison ignores only a harmless www and trailing slash", () => {
  assert.equal(sameDestination("https://www.example.gov/apply/", "https://example.gov/apply"), true);
  assert.equal(sameDestination("https://example.gov/apply", "https://example.gov/renew"), false);
  assert.equal(sameDestination("https://example.gov/apply?lang=en", "https://example.gov/apply?lang=es"), false);
});

test("CMS phone extraction stays within each state and preserves multiple listed lines", () => {
  const html = '<h3 id="AA">One</h3><a href="tel:+1 (800) 362-1504">800-362-1504</a>'
    + '<a href="tel:+1 (334) 242-5000">334-242-5000</a>'
    + '<h3 id="BB">Two</h3><a href="tel:+1 (202) 727-5355">202-727-5355</a>'
    + '<h3 id="CC">Three</h3>No listed phone';
  const phones = parseCmsListedPhones(html);
  assert.deepEqual(phones.get("AA"), ["8003621504", "3342425000"]);
  assert.deepEqual(phones.get("BB"), ["2027275355"]);
  assert.deepEqual(phones.get("CC"), []);
});
