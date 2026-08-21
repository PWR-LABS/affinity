import assert from "node:assert/strict";
import { test } from "node:test";

import { checkEligibility, officialStateHandoff } from "@/lib/decision/eligibility";

test("state-marketplace users get a safe official handoff without a federal estimate", async () => {
  const result = await checkEligibility({
    state: "NY",
    zip: "10001",
    income: 24_000,
    householdSize: 1,
    age: 35,
    year: 2026,
  });

  assert.equal(result.verdict, "state_marketplace");
  assert.equal(result.state, "NY");
  assert.equal(result.medicaidEligible, false);
  assert.match(result.headline, /won't guess/i);
  assert.match(result.notes.join(" "), /No eligibility verdict/i);
});

test("unknown state codes fail closed", async () => {
  await assert.rejects(
    checkEligibility({ state: "XX", zip: "00000", income: 0, householdSize: 1, age: 30, year: 2026 }),
    /Unsupported state code/,
  );
});

test("live-data outages degrade to an official state decision path", () => {
  const result = officialStateHandoff("OH", "44113");
  assert.equal(result.verdict, "official_handoff");
  assert.equal(result.state, "OH");
  assert.match(result.headline, /official coverage decision/i);
  assert.match(result.notes.join(" "), /No eligibility verdict/i);
});
