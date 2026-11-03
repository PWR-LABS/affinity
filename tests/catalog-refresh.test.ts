import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { buildCatalog } from "../scripts/update-marketplace-catalog";
import { assertCatalog, catalogFreshness, catalogNeedsPublication, CATALOG_MAX_AGE_MS } from "@/lib/marketplace/catalog";
import { MARKETPLACE_CATALOG } from "@/lib/marketplace/states";
import { STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";
import { POST as eligibility } from "@/app/api/eligibility/route";
import { POST as plans } from "@/app/api/plans/route";
import { POST as providers } from "@/app/api/providers/autocomplete/route";
import { GET as freshness } from "@/app/api/freshness/route";

const codes = STATE_MEDICAID_RESOURCES.map((row) => row.code);
const now = Date.parse("2026-11-03T12:00:00Z");
const key = "catalog-fixture-secret";
function transport(change?: (path: string, data: Record<string, unknown>) => unknown) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://marketplace.api.healthcare.gov");
    assert.equal(url.searchParams.get("apikey"), key);
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    const replacement = change?.(url.pathname, data);
    if (replacement !== undefined) return Response.json(replacement);
    if (url.pathname.endsWith("/market-years")) return Response.json({ current: 2028, supported: [2026, 2027, 2028] });
    if (url.pathname.endsWith("/states")) return Response.json({ states: codes.map((code) => ({ abbrev: code, name: code, marketplace_model: code === "OR" ? "SBM" : "FFM", hix_name: "Explore Health", hix_url: "https://explorehealthor.gov/" })).concat([{ abbrev: "XX", name: "Territory", marketplace_model: "UnknownMarketplaceModel", hix_name: "", hix_url: "" }]) });
    if (url.pathname.includes("/counties/")) {
      const state = ({ "44106": "OH", "33101": "FL", "77002": "TX", "72201": "AR", "73104": "OK" } as Record<string, string>)[url.pathname.split("/").at(-1)!];
      return Response.json({ counties: [{ state, fips: "12345" }] });
    }
    if (url.pathname.endsWith("/estimates")) return Response.json({ estimates: [{ aptc: 100, is_medicaid_chip: false, in_coverage_gap: false }] });
    if (url.pathname.endsWith("/search")) { const state = data.place.state; return Response.json({ total: 1, plans: [{ id: `12345${state}0000001`, state, premium: 400 }] }); }
    throw new Error(`fixture request failed ${url}`);
  }) as typeof fetch;
}

test("discovers a new official current year without using the calendar or copying last year's routing", async () => {
  const result = await buildCatalog({ apiKey: key, previous: MARKETPLACE_CATALOG, fetchImpl: transport(), now });
  assert.equal(result.candidate.defaultYear, 2028);
  assert.deepEqual(Object.keys(result.candidate.years), ["2026", "2027", "2028"]);
  assert.equal(result.outcomes.length, 15);
  assert.equal(result.candidate.years["2028"].marketplaces.OR.url, "explorehealthor.gov");
  assertCatalog(result.candidate, codes);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test("incomplete state metadata and unknown models fail instead of inheriting old routing", async () => {
  for (const states of [[], codes.map((abbrev) => ({ abbrev, marketplace_model: "new_unknown_model" }))]) {
    await assert.rejects(buildCatalog({ apiKey: key, fetchImpl: transport((path) => path.endsWith("/states") ? { states } : undefined), now }));
  }
});

test("a successful HTTP response with missing eligibility or plans cannot publish a new year", async () => {
  for (const endpoint of ["/estimates", "/search"]) await assert.rejects(buildCatalog({ apiKey: key, fetchImpl: transport((path) => path.endsWith(endpoint) ? {} : undefined), now }), /probe_/);
});

test("an advertised next year with incomplete data is deferred without blocking accepted years", async () => {
  const result = await buildCatalog({ apiKey: key, fetchImpl: transport((path, data) => path.endsWith("/market-years") ? { current: 2027, supported: [2026, 2027, 2028] } : path.endsWith("/search") && data.year === 2028 ? {} : undefined), now });
  assert.equal(result.candidate.defaultYear, 2027);
  assert.deepEqual(Object.keys(result.candidate.years), ["2026", "2027"]);
  assert.deepEqual(result.deferredYears, [2028]);
});

test("unresolved counties stop the candidate and source exceptions never expose the key", async () => {
  await assert.rejects(buildCatalog({ apiKey: key, fetchImpl: transport((path) => path.includes("/counties/") ? { counties: [{ state: "OH", fips: "12345" }, { state: "OH", fips: "67890" }] } : undefined), now }), /geography/);
  await assert.rejects(buildCatalog({ apiKey: key, fetchImpl: (async () => { throw new Error(`https://source.example?apikey=${key}`); }) as typeof fetch, now }), (error: unknown) => error instanceof Error && !error.message.includes(key));
});

test("receipt refresh is bounded; unchanged sources do not cause daily commits", () => {
  const candidate = { ...MARKETPLACE_CATALOG, checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + CATALOG_MAX_AGE_MS).toISOString() };
  assert.equal(catalogNeedsPublication(candidate, { ...candidate, checkedAt: new Date(now + 1000).toISOString() }, now + 1000), false);
  assert.equal(catalogNeedsPublication(candidate, candidate, now + 6 * 24 * 60 * 60 * 1000), true);
  assert.equal(catalogFreshness(candidate, now).status, "current");
  assert.equal(catalogFreshness(candidate, now + CATALOG_MAX_AGE_MS).status, "stale");
  assert.equal(catalogFreshness(candidate, now - 1).status, "stale");
});

test("expiry stops estimates and provider lookups, with an honest official handoff", async () => {
  const originalFetch = globalThis.fetch;
  const previousTime = Date.now();
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("No source request expected after expiry"); }) as typeof fetch;
  mock.timers.setTime(Date.parse(MARKETPLACE_CATALOG.expiresAt));
  try {
    const request = (body: unknown) => new Request("https://affinity.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const input = { state: "OH", zip: "44106", age: 40, income: 45_000, householdSize: 1, year: 2027 };
    const result = await (await eligibility(request(input))).json();
    assert.equal(result.sourceFreshness, "stale");
    assert.equal(result.verdict, "official_handoff");
    assert.equal(result.aptcMonthly, 0);
    assert.equal((await plans(request(input))).status, 503);
    assert.equal((await providers(request({ q: "Smith", zip: "44106", year: 2027 }))).status, 503);
    assert.equal((await freshness()).status, 503);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; mock.timers.setTime(previousTime); }
});
