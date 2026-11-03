import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { POST as eligibility } from "@/app/api/eligibility/route";
import { POST as plans } from "@/app/api/plans/route";
import { POST as providers } from "@/app/api/providers/autocomplete/route";
import { checkEligibility } from "@/lib/decision/eligibility";
import { runLivePlans } from "@/lib/decision/live";
import { UnsupportedMarketplacePlanYearError } from "@/lib/marketplace/states";

const base = { state: "OH", zip: "44106", age: 40, income: 45_000, householdSize: 1 };
const request = (body: Record<string, unknown>) => new Request("https://affinity.invalid/api/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function transport(t: TestContext, state = "OH") {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MARKETPLACE_API_KEY;
  const calls: Array<{ url: URL; body?: Record<string, unknown> }> = [];
  process.env.MARKETPLACE_API_KEY = "year-fixture-only";
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url, body });
    const id = `12345${state}0000001`;
    if (url.pathname.includes("/counties/by/zip/")) return Response.json({ counties: [{ state, fips: "12345", name: "Fixture County" }] });
    if (url.pathname.endsWith("/eligibility/estimates")) return Response.json({ estimates: [{ aptc: 100, is_medicaid_chip: false, in_coverage_gap: false }] });
    if (url.pathname.endsWith("/plans/search")) return Response.json({ plans: [{ id, premium: 400, metal_level: "Silver" }], total: 1 });
    if (url.pathname.endsWith("/providers/autocomplete")) return Response.json([{ npi: "1234567890", name: "Synthetic doctor" }]);
    if (url.pathname.endsWith("/providers/covered")) return Response.json({ coverage: [{ npi: "1234567890", plan_id: id, coverage: "Covered" }] });
    if (url.pathname.endsWith("/drugs/covered")) return Response.json({ coverage: [{ rxcui: "123", plan_id: id, coverage: "Covered" }] });
    throw new Error("unexpected fixture endpoint");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MARKETPLACE_API_KEY;
    else process.env.MARKETPLACE_API_KEY = originalKey;
  });
  return calls;
}

test("Oregon 2027 eligibility hands off without any CMS call; 2026 still reaches the federal source", async (t) => {
  const calls = transport(t, "OR");
  const next = await eligibility(request({ ...base, state: "OR", zip: "97201", year: 2027 }));
  assert.equal(next.status, 200);
  const handoff = await next.json();
  assert.equal(handoff.year, 2027);
  assert.equal(handoff.verdict, "state_marketplace");
  assert.match(handoff.nextSteps.join(" "), /Explore Health/);
  assert.equal(calls.length, 0);
  const control = await eligibility(request({ ...base, state: "OR", zip: "97201", year: 2026 }));
  assert.equal((await control.json()).year, 2026);
  assert.equal(calls.length, 3);
  for (const call of calls.filter((call) => call.body)) assert.equal(call.body!.year, 2026);
});

test("Oregon 2027 plan board stops after geography and never requests a federal quote", async (t) => {
  const calls = transport(t, "OR");
  const response = await plans(request({ ...base, zip: "97201", year: 2027 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Explore Health.*explorehealthor\.gov/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url.pathname, /counties\/by\/zip/);
});

test("2027 is carried through eligibility, plan search, doctor lookup and coverage requests", async (t) => {
  const calls = transport(t);
  const input = { ...base, year: 2027 };
  const screening = await eligibility(request(input));
  assert.equal((await screening.json()).year, 2027);
  const board = await plans(request({ ...input, doctors: [{ npi: "1234567890" }], drugs: [{ rxcui: "123" }] }));
  const result = await board.json();
  assert.equal(board.status, 200);
  assert.equal(result.year, 2027);
  assert.equal(result.plans[0].netPremiumAnnual, 3600);
  assert.equal(result.plans[0].doctors[0].covered, true);
  const lookup = await providers(request({ q: "Smith", zip: base.zip, year: 2027 }));
  assert.equal(lookup.status, 200);
  for (const call of calls.filter((call) => call.body)) assert.equal(call.body!.year, 2027);
  const yearGets = calls.filter((call) => /\/covered$|providers\/autocomplete$/.test(call.url.pathname));
  assert.equal(yearGets.length, 3);
  for (const call of yearGets) assert.equal(call.url.searchParams.get("year"), "2027");
});

test("omitted year stays 2026 and official larger-household handoffs echo the chosen year", async (t) => {
  const calls = transport(t);
  const response = await eligibility(request(base));
  assert.equal((await response.json()).year, 2026);
  for (const call of calls.filter((call) => call.body)) assert.equal(call.body!.year, 2026);
  const count = calls.length;
  const handoff = await eligibility(request({ ...base, householdSize: 2, year: 2027 }));
  const result = await handoff.json();
  assert.equal(result.year, 2027);
  assert.equal(result.verdict, "official_handoff");
  assert.equal(calls.length, count);
});

test("direct engine callers cannot bypass the unknown-year guard", async (t) => {
  const calls = transport(t);
  await assert.rejects(checkEligibility({ ...base, year: 2028 }), UnsupportedMarketplacePlanYearError);
  await assert.rejects(runLivePlans({ ...base, year: 2028, doctors: [], drugs: [] }), UnsupportedMarketplacePlanYearError);
  assert.equal(calls.length, 0);
});
