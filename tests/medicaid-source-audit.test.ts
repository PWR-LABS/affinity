import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCmsEnrollmentLinks, sameDestination } from "../scripts/eval-medicaid-handoffs";

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
