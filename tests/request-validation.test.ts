import assert from "node:assert/strict";
import { test } from "node:test";

import { POST as checkEligibility } from "@/app/api/eligibility/route";
import { POST as findPlans } from "@/app/api/plans/route";
import { POST as findProviders } from "@/app/api/providers/autocomplete/route";

const base = { state: "OH", zip: "44106", age: 30, income: 55_000, householdSize: 1, year: 2026 };

function request(body: Record<string, unknown>) {
  return new Request("https://affinity.pwr-labs.ai/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

for (const [label, handler] of [["eligibility", checkEligibility], ["plans", findPlans]] as const) {
  test(`${label} rejects unsupported plan years before calling the live source`, async () => {
    for (const year of [2025, 2027, "not-a-year"]) {
      const response = await handler(request({ ...base, year }));
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /supports 2026 only/i);
    }
  });

  test(`${label} rejects blank income before calling the live source`, async () => {
    const response = await handler(request({ ...base, income: "" }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /annual income/i);
  });

  test(`${label} rejects blank age before calling the live source`, async () => {
    const response = await handler(request({ ...base, age: "" }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /valid age/i);
  });
}

test("eligibility routes a multi-person household to the official application without a live estimate", async () => {
  const response = await checkEligibility(request({ ...base, householdSize: 2 }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.verdict, "official_handoff");
  assert.equal(result.aptcMonthly, 0);
  assert.match(result.notes.join(" "), /no multi-person eligibility/i);
});

test("plans rejects multi-person estimates built from one age", async () => {
  const response = await findPlans(request({ ...base, householdSize: 2 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /one person at a time/i);
});

test("provider lookup rejects an unsupported plan year before reaching CMS", async () => {
  const response = await findProviders(request({ q: "Smith", zip: "44106", year: 2027 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /supports 2026 only/i);
});
