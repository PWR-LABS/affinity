import assert from "node:assert/strict";
import { test } from "node:test";

import { auditPlanYearAvailability } from "../scripts/eval-plan-year-availability";

const COMMIT = "a".repeat(40);
const KEY = "audit-test-secret";
const json = (value: unknown, status = 200) => Response.json(value, { status });

function fixture(override?: (url: URL, body: Record<string, unknown>) => Response | undefined) {
  const requests: Array<{ url: URL; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    requests.push({ url, body });
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal, "every probe has a timeout");
    const replacement = override?.(url, body);
    if (replacement) return replacement;
    if (url.hostname === "affinity.pwr-labs.ai") {
      assert.equal(url.searchParams.has("apikey"), false);
      if (url.pathname === "/api/health") return json({ status: "ok", release: { commit: COMMIT }, checks: { marketplaceApi: "ok" } });
      return json({ error: "This comparison currently supports 2026 only." }, 400);
    }
    assert.equal(url.hostname, "marketplace.api.healthcare.gov");
    assert.equal(url.searchParams.get("apikey"), KEY);
    if (url.pathname.startsWith("/api/v1/counties/by/zip/")) {
      const state = ({ "44106": "OH", "33101": "FL", "77002": "TX", "72201": "AR", "73104": "OK" } as Record<string, string>)[url.pathname.split("/").at(-1)!];
      return json({ counties: [{ state, fips: "12345" }] });
    }
    if (url.pathname.endsWith("/eligibility/estimates")) return json({ estimates: [{ aptc: 100, is_medicaid_chip: false, in_coverage_gap: false }] });
    if (url.pathname.endsWith("/plans/search")) {
      const state = (body.place as { state: string }).state;
      return json({ plans: [{ id: `12345${state}0000001`, state, premium: 400, benefits_url: `https://issuer.example/${body.year}/summary.pdf` }], total: 1 });
    }
    if (url.pathname.endsWith("/providers/autocomplete")) return json([{ npi: "1234567890", name: "not retained" }]);
    if (url.pathname.endsWith("/drugs/autocomplete")) return json([{ rxcui: "123", name: "not retained" }]);
    if (url.pathname.endsWith("/covered")) return json({ coverage: [] });
    throw new Error("Unexpected fixture request");
  }) as typeof fetch;
  return { fetchImpl, requests };
}

test("availability audit keeps year-scoped probes bounded and separate from consumer readiness", async () => {
  const { fetchImpl, requests } = fixture();
  const result = await auditPlanYearAvailability({ apiKey: KEY, sourceCommit: COMMIT, harnessSha256: "fixture", fetchImpl });
  assert.equal(result.observationsComplete, true);
  assert.equal(result.readiness, "NOT_ENABLED");
  assert.deepEqual(result.counts, { plannedProfiles: 6, availableProfiles: 6, unavailableProfiles: 0 });
  const searches = requests.filter(({ url }) => url.pathname === "/api/v1/plans/search");
  assert.equal(searches.length, 6);
  assert.deepEqual(searches.map(({ body }) => body.year), [2026, 2027, 2027, 2027, 2027, 2027]);
  for (const { body } of searches) { assert.equal(body.limit, 10); assert.equal(body.offset, 0); }
  for (const { url } of requests.filter(({ url }) => /providers\/autocomplete|\/covered$/.test(url.pathname) && url.hostname === "marketplace.api.healthcare.gov")) assert.equal(url.searchParams.get("year"), "2027");
  const evidence = JSON.stringify(result);
  assert.equal(evidence.includes(KEY), false);
  assert.equal(evidence.includes("not retained"), false);
  assert.equal(result.lookups.providerCoverage.rowsReturned, 0, "empty coverage is an observation, not noncoverage");
});

test("HTTP 200 with empty estimates/plans cannot complete the availability audit", async () => {
  const { fetchImpl } = fixture((url) => url.pathname.endsWith("/eligibility/estimates") ? json({ estimates: [] }) : url.pathname.endsWith("/plans/search") ? json({ plans: [], total: 0 }) : undefined);
  const result = await auditPlanYearAvailability({ apiKey: KEY, sourceCommit: COMMIT, harnessSha256: "fixture", fetchImpl });
  assert.equal(result.observationsComplete, false);
  assert.equal(result.counts.availableProfiles, 0);
});

test("ambiguous geography is preserved as unavailable without choosing a county", async () => {
  const { fetchImpl, requests } = fixture((url) => url.pathname.includes("/counties/") ? json({ counties: [{ state: "OH", fips: "12345" }, { state: "OH", fips: "67890" }] }) : undefined);
  const result = await auditPlanYearAvailability({ apiKey: KEY, sourceCommit: COMMIT, harnessSha256: "fixture", fetchImpl });
  assert.equal(result.counts.unavailableProfiles, 6);
  assert.equal(requests.some(({ url }) => url.pathname.endsWith("/plans/search")), false);
});

test("wrong-year rows and deployment transitions make observations incomplete", async () => {
  let healthCalls = 0;
  const { fetchImpl } = fixture((url, body) => {
    if (url.pathname === "/api/health" && ++healthCalls === 2) return json({ status: "ok", release: { commit: "b".repeat(40) }, checks: { marketplaceApi: "ok" } });
    if (url.pathname === "/api/v1/plans/search") {
      const state = (body.place as { state: string }).state;
      return json({ plans: [{ id: `12345${state}0000001`, state, premium: 400, year: 2025 }], total: 1 });
    }
  });
  const result = await auditPlanYearAvailability({ apiKey: KEY, sourceCommit: COMMIT, harnessSha256: "fixture", fetchImpl });
  assert.equal(result.observationsComplete, false);
  assert.equal(result.production.releaseStable, false);
  assert.equal(result.counts.availableProfiles, 0);
});

test("upstream errors retain only coarse status, never URLs, bodies, or exception text", async () => {
  const { fetchImpl } = fixture((url) => {
    if (url.pathname.includes("/counties/")) throw new Error(`failed URL: ${url}`);
    if (url.pathname.endsWith("/autocomplete")) return json({ error: `sensitive source body ${KEY}` }, 403);
  });
  const result = await auditPlanYearAvailability({ apiKey: KEY, sourceCommit: COMMIT, harnessSha256: "fixture", fetchImpl });
  const evidence = JSON.stringify(result);
  for (const secret of [KEY, "failed URL", "sensitive source body", "apikey="]) assert.equal(evidence.includes(secret), false);
  assert.equal(result.observationsComplete, false);
  assert.equal(result.lookups.providerAutocomplete.httpStatus, 403);
});

test("a deployed 2027 acceptance is not misreported as a passing rejection guard", async () => {
  const { fetchImpl } = fixture((url) => url.hostname === "affinity.pwr-labs.ai" && url.pathname === "/api/plans" ? json({ plans: [] }) : undefined);
  const result = await auditPlanYearAvailability({ apiKey: KEY, sourceCommit: COMMIT, harnessSha256: "fixture", fetchImpl });
  assert.equal(result.observationsComplete, false);
  assert.equal(result.guards.find((guard) => guard.path === "/api/plans")?.rejectsTargetYear, false);
});
