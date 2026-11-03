import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { evaluateEligibilityProfile } from "../scripts/eval-marketplace-source-pair";
import { evaluatePlanProfile } from "../scripts/eval-plan-board-source-pair";
import { sourceStateRoute } from "../scripts/source-state-route";

test("source-pair routing rejects missing, duplicate, unknown or insecure official metadata", async () => {
  const row = { abbrev: "OH", marketplace_model: "SBM", hix_name: "New Ohio Exchange", hix_url: "https://new.example.gov/" };
  for (const states of [[], [row, row], [{ ...row, marketplace_model: "unknown_model" }], [{ ...row, hix_url: "http://new.example.gov/" }]]) {
    await assert.rejects(sourceStateRoute(async () => ({ states }), 2028, "OH"));
  }
});

function transitionTransport(t: TestContext, staleApp = false) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MARKETPLACE_API_KEY;
  const calls: string[] = [];
  process.env.MARKETPLACE_API_KEY = "source-pair-fixture-only";
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname.endsWith("/states")) return Response.json({ states: [{ abbrev: "OH", marketplace_model: "SBM", hix_name: "New Ohio Exchange", hix_url: "https://new.example.gov/" }] });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === "/api/eligibility") return Response.json({ year: body.year, state: "OH", verdict: staleApp ? "marketplace" : "state_marketplace", aptcMonthly: 0, medicaidEligible: false, inCoverageGap: false, nextSteps: ["Use New Ohio Exchange."] });
    if (url.pathname === "/api/plans") return Response.json({ error: staleApp ? "Use the former exchange: old.example.gov" : "Use New Ohio Exchange: new.example.gov" }, { status: 400 });
    throw new Error("No federal quote request expected for the new state exchange");
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.MARKETPLACE_API_KEY; else process.env.MARKETPLACE_API_KEY = originalKey; });
  return calls;
}

test("deployed source-pair checks accept a profile's transition to an official state exchange", async (t) => {
  const calls = transitionTransport(t);
  const eligibility = await evaluateEligibilityProfile({ id: "fixture", state: "OH", zip: "44106", age: 50, income: 45_000 });
  const plans = await evaluatePlanProfile({ id: "oh-subsidized", state: "OH", zip: "44106", age: 50, income: 45_000 });
  assert.equal(eligibility.evidenceBasis, "official_exchange_handoff");
  assert.deepEqual(eligibility.differences, []);
  assert.equal(plans.evidenceBasis, "official_exchange_handoff");
  assert.deepEqual(plans.profileDifferences, []);
  assert.deepEqual(plans.rows, []);
  assert.equal(calls.filter((path) => path.endsWith("/states")).length, 2);
});

test("state-exchange source pairs still reject a stale application route or destination", async (t) => {
  transitionTransport(t, true);
  const eligibility = await evaluateEligibilityProfile({ id: "fixture", state: "OH", zip: "44106", age: 50, income: 45_000 });
  const plans = await evaluatePlanProfile({ id: "oh-subsidized", state: "OH", zip: "44106", age: 50, income: 45_000 });
  assert.ok((eligibility.differences as string[]).includes("verdict"));
  assert.ok((plans.profileDifferences as string[]).includes("officialExchangeUrl"));
});
