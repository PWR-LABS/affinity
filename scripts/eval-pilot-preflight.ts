/**
 * Synthetic Outside-In routing preflight. The Marketplace transport is fixture-only:
 * this does not validate current official figures, links, usability, or UH approval.
 */
import assert from "node:assert/strict";

import { POST as checkEligibility } from "@/app/api/eligibility/route";
import { POST as checkPlans } from "@/app/api/plans/route";

type MockScenario = {
  countyState?: string;
  noCounty?: boolean;
  multiCounty?: boolean;
  outage?: boolean;
  medicaid?: boolean;
  aptc?: number;
  gap?: boolean;
  planCount?: number;
};

type SyntheticCase = {
  id: string;
  input: Record<string, unknown>;
  status: number;
  verdict?: string;
  error?: RegExp;
  mock?: MockScenario;
};

const base = { state: "OH", zip: "44106", income: 25_000, householdSize: 1, age: 30, year: 2026 };

const stateMarketplaceCases: SyntheticCase[] = ["CA", "CO", "DC", "GA", "IL", "NY", "WA", "PA"].map((state) => ({
  id: `state-marketplace-${state}`,
  input: { ...base, state, zip: "12345" }, // Valid-format synthetic ZIP; no real address is asserted.
  status: 200,
  verdict: "state_marketplace",
}));

const multiPersonCases: SyntheticCase[] = ["OH", "FL", "TX", "AK", "CA", "NY", "IL", "WV"].map((state, index) => ({
  id: `multi-person-${state}`,
  input: { ...base, state, zip: "12345", householdSize: 2 + (index % 4) },
  status: 200,
  verdict: "official_handoff",
}));

const federalCases: SyntheticCase[] = [
  { id: "federal-medicaid", input: { ...base }, status: 200, verdict: "medicaid", mock: { medicaid: true, planCount: 2 } },
  { id: "federal-subsidized", input: { ...base, income: 48_000 }, status: 200, verdict: "marketplace", mock: { aptc: 285, planCount: 3 } },
  { id: "federal-unsubsidized", input: { ...base, state: "FL", zip: "33101", income: 100_000 }, status: 200, verdict: "marketplace", mock: { planCount: 2 } },
  { id: "federal-coverage-gap", input: { ...base, state: "TX", zip: "77002", income: 9_000 }, status: 200, verdict: "coverage_gap", mock: { gap: true, planCount: 2 } },
  { id: "federal-no-estimate", input: { ...base, state: "MI", zip: "48201" }, status: 200, verdict: "unknown", mock: { planCount: 0 } },
  { id: "federal-zip-state-mismatch", input: { ...base }, status: 200, verdict: "unknown", mock: { countyState: "PA" } },
  { id: "federal-county-missing", input: { ...base }, status: 200, verdict: "unknown", mock: { noCounty: true } },
  { id: "federal-county-ambiguous", input: { ...base, state: "TX", zip: "77449" }, status: 200, verdict: "official_handoff", mock: { multiCounty: true } },
  { id: "federal-upstream-outage", input: { ...base }, status: 200, verdict: "official_handoff", mock: { outage: true } },
];

const invalidCases: SyntheticCase[] = [
  { id: "invalid-state", input: { ...base, state: "XX" }, status: 400, error: /select your state/i },
  { id: "invalid-zip", input: { ...base, zip: "4410" }, status: 400, error: /5-digit ZIP/i },
  { id: "missing-income", input: { ...base, income: "" }, status: 400, error: /annual income/i },
  { id: "negative-income", input: { ...base, income: -1 }, status: 400, error: /annual income/i },
  { id: "missing-age", input: { ...base, age: "" }, status: 400, error: /valid age/i },
  { id: "invalid-household-size", input: { ...base, householdSize: 13 }, status: 400, error: /household size/i },
];

const cases = [...stateMarketplaceCases, ...multiPersonCases, ...federalCases, ...invalidCases];
assert.equal(cases.length, 31);
assert.equal(new Set(cases.map((item) => item.id)).size, 31);

function mockTransport(scenario: MockScenario, state: string, calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${(init?.method ?? "GET").toUpperCase()} ${url.pathname}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
    if (scenario.outage) return json({ error: "fixture outage" }, 503);
    if (url.pathname.includes("/counties/by/zip/")) {
      return json({ counties: scenario.noCounty ? [] : scenario.multiCounty
        ? [{ fips: "48201", state, name: "Harris County" }, { fips: "48157", state, name: "Fort Bend County" }]
        : [{ fips: "39035", state: scenario.countyState ?? state, name: "Fixture County" }] });
    }
    if (url.pathname.endsWith("/households/eligibility/estimates")) {
      return json({ estimates: [{ is_medicaid_chip: scenario.medicaid ?? false, aptc: scenario.aptc ?? 0, in_coverage_gap: scenario.gap ?? false }] });
    }
    if (url.pathname.endsWith("/plans/search")) {
      return json({ total: scenario.planCount ?? 0, plans: scenario.planCount ? [{ id: "FIXTURE-PLAN", premium: 420 }] : [] });
    }
    throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
  }) as typeof fetch;
}

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.MARKETPLACE_API_KEY;
  const failures: string[] = [];
  const counts = new Map<string, number>();
  try {
    process.env.MARKETPLACE_API_KEY = "pilot-fixture-only";
    for (const item of cases) {
      const calls: string[] = [];
      const capturedLogs: string[] = [];
      const priorConsoleError = console.error;
      globalThis.fetch = item.mock
        ? mockTransport(item.mock, String(item.input.state), calls)
        : (async () => { throw new Error("Unexpected external request in a handoff or validation case"); }) as typeof fetch;
      if (item.mock?.outage) console.error = (...parts: unknown[]) => { capturedLogs.push(parts.map(String).join(" ")); };
      try {
        const request = new Request("https://affinity.invalid/api/eligibility", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item.input),
        });
        const response = await checkEligibility(request);
        const body = await response.json() as Record<string, unknown>;
        assert.equal(response.status, item.status, "HTTP status");
        if (item.verdict) assert.equal(body.verdict, item.verdict, "routing verdict");
        if (item.error) assert.match(String(body.error), item.error, "validation message");
        if (item.verdict === "state_marketplace" || item.verdict === "official_handoff") {
          assert.equal(body.aptcMonthly, 0, "handoff cannot invent a subsidy");
          assert.equal(body.medicaidEligible, false, "handoff cannot invent eligibility");
        }
        if (item.mock?.multiCounty) {
          assert.match(String(body.headline), /multiple counties/i);
          assert.equal(body.planCount, undefined, "ambiguous ZIP cannot show a plan count");
          assert.deepEqual(calls, ["GET /api/v1/counties/by/zip/77449"], "no estimate or plan search after ambiguity");
        }
        if (!item.mock) assert.equal(calls.length, 0, "no upstream call expected");
        if (item.mock && !item.mock.outage && !item.mock.noCounty && !item.mock.multiCounty && !item.mock.countyState) {
          assert.equal(calls.length, 3, "county, estimate, and plan-context calls expected");
        }
        if (item.mock?.outage) {
          assert.match(capturedLogs.join(" "), /marketplace_503/);
          assert.doesNotMatch(capturedLogs.join(" "), /44106|25000|counties\/by\/zip/i, "log must not contain inputs or request path");
        }
        counts.set(String(body.verdict ?? `HTTP ${response.status}`), (counts.get(String(body.verdict ?? `HTTP ${response.status}`)) ?? 0) + 1);
        console.log(`PASS ${item.id}`);
      } catch (error) {
        failures.push(`${item.id}: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`FAIL ${item.id}`);
      } finally {
        console.error = priorConsoleError;
      }
    }
    // A failed plan-board ZIP lookup also carries a ZIP in the upstream exception message.
    // Verify the outward error and server log both stay generic.
    const planLogs: string[] = [];
    const priorConsoleError = console.error;
    globalThis.fetch = mockTransport({ outage: true }, "OH", []);
    console.error = (...parts: unknown[]) => { planLogs.push(parts.map(String).join(" ")); };
    try {
      const request = new Request("https://affinity.invalid/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, doctors: [], drugs: [] }),
      });
      const response = await checkPlans(request);
      assert.equal(response.status, 502);
      assert.match(planLogs.join(" "), /marketplace_503/);
      assert.doesNotMatch(planLogs.join(" "), /44106|25000|counties\/by\/zip/i);
      console.log("PASS plan-board-failure-log-redaction");
    } catch (error) {
      failures.push(`plan-board-failure-log-redaction: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      console.error = priorConsoleError;
    }
    const ambiguousPlanCalls: string[] = [];
    globalThis.fetch = mockTransport({ multiCounty: true }, "TX", ambiguousPlanCalls);
    try {
      const request = new Request("https://affinity.invalid/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...base, state: "TX", zip: "77449", doctors: [], drugs: [] }),
      });
      const response = await checkPlans(request);
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 409);
      assert.equal(body.code, "county_ambiguous");
      assert.deepEqual(ambiguousPlanCalls, ["GET /api/v1/counties/by/zip/77449"]);
      console.log("PASS plan-board-county-ambiguous");
    } catch (error) {
      failures.push(`plan-board-county-ambiguous: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MARKETPLACE_API_KEY;
    else process.env.MARKETPLACE_API_KEY = originalKey;
  }
  console.log(`\nSynthetic routing preflight: ${cases.length - failures.filter((failure) => !failure.startsWith("plan-board-")).length}/${cases.length} passed`);
  console.log(`Outcomes: ${[...counts].map(([label, count]) => `${label}=${count}`).join(", ")}`);
  console.log("Fixture transport only. Official figures/links, users, accessibility, and UH gates remain unverified.");
  if (failures.length) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
