import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { NextRequest } from "next/server";

import { CARESOURCE_FHIR_BASE, COVERAGE_ORIGIN, careSourceConfig, summarizeCareSourceCoverage } from "../src/lib/insurers/caresource";
import { finishCareSource, returnCareSourceResult, startCareSource } from "../src/lib/insurers/caresource-flow";
import { findOhioCoverageResources } from "../src/lib/insurers/ohio-insurers";

const enabledEnv = {
  AFFINITY_CARESOURCE_ENABLED: "1",
  AFFINITY_CARESOURCE_CLIENT_ID: "fixture-client",
  AFFINITY_CARESOURCE_CLIENT_SECRET: "fixture-secret",
  AFFINITY_CARESOURCE_COOKIE_KEY: "42".repeat(32),
  AFFINITY_CARESOURCE_OH_MEDICAID_PLAN_IDS: "OH-FIXTURE",
};

function coverage(id = "OH-FIXTURE", patient = "test-member") {
  return { resource: {
    resourceType: "Coverage",
    beneficiary: { reference: `Patient/${patient}` },
    subscriberId: "private-fixture",
    status: "active",
    period: { start: "2026-01-01", end: "2026-02-30" },
    class: [
      { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/coverage-class", code: "plan" }] },
        value: id, name: "Ohio fixture plan" },
    ],
  } };
}
function bundle(...entry: unknown[]) {
  return { resourceType: "Bundle", type: "searchset", entry };
}
function request(path: string, options: { origin?: string; cookie?: string; post?: boolean } = {}) {
  const headers = new Headers();
  if (options.origin) headers.set("origin", options.origin);
  if (options.cookie) headers.set("cookie", options.cookie);
  return new NextRequest(new URL(path, COVERAGE_ORIGIN), { headers, method: options.post ? "POST" : "GET" });
}
function cookie(response: Awaited<ReturnType<typeof startCareSource>>, name: string) {
  const result = response.cookies.get(name);
  assert.ok(result);
  return `${name}=${result.value}`;
}

test("directory recognizes aliases and names without sending a search to a payer", () => {
  assert.deepEqual(findOhioCoverageResources("care source").map(row => row.name), ["CareSource"]);
  assert.deepEqual(findOhioCoverageResources("BCBS").map(row => row.name), ["Anthem Blue Cross and Blue Shield"]);
  assert.ok(findOhioCoverageResources("medicare").some(row => row.name === "Medicare.gov account"));
  assert.deepEqual(findOhioCoverageResources("unlisted plan"), []);
  assert.ok(findOhioCoverageResources("").every(row => new URL(row.href).protocol === "https:"));
});

test("connection requires explicit opt-in, client credentials, key, and confirmed Ohio plan identities", () => {
  assert.equal(careSourceConfig({}), null);
  for (const key of Object.keys(enabledEnv)) {
    assert.equal(careSourceConfig({ ...enabledEnv, [key]: "" }), null);
  }
  assert.equal(careSourceConfig(enabledEnv)?.planIds.has("OH-FIXTURE"), true);
});

test("coverage summaries require exact member and product identity and omit private source fields", () => {
  const another = coverage("OH-FIXTURE", "test-dependent");
  const mistaken = coverage("CA-FIXTURE");
  const draft = coverage();
  draft.resource.status = "draft";
  const summary = summarizeCareSourceCoverage(
    { ...bundle(coverage(), another, mistaken, draft), link: [{ relation: "next", url: "https://example.invalid" }] },
    "test-member", new Set(["OH-FIXTURE"]),
  );
  assert.deepEqual(summary.rows, [
    { planName: "Ohio fixture plan", status: "active", startsOn: "2026-01-01", endsOn: null },
  ]);
  assert.equal(summary.limited, true);
  assert.doesNotMatch(JSON.stringify(summary), /private-fixture|test-member|test-dependent/);
});

test("SMART start, callback, and result use the browser-bound code once and return only a coverage summary", async t => {
  const before = Object.fromEntries(Object.keys(enabledEnv).map(key => [key, process.env[key]]));
  Object.assign(process.env, enabledEnv);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const startPath = "/api/insurer/caresource/start";
  const resultPath = "/api/insurer/caresource/result";
  const callbackPath = "/api/insurer/caresource/callback";
  const FLOW_COOKIE = "__Host-affinity-care-source-flow";
  const CODE_COOKIE = "__Host-affinity-care-source-code";

  const foreign = await startCareSource(request(startPath, { origin: "https://example.invalid", post: true }));
  assert.equal(foreign.status, 403);
  const start = await startCareSource(request(startPath, { origin: COVERAGE_ORIGIN, post: true }));
  assert.equal(start.status, 200);
  const auth = new URL((await start.json()).authorizationUrl);
  const state = auth.searchParams.get("state");
  assert.equal(auth.searchParams.get("scope"), "launch/patient patient/Coverage.read");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.equal(start.cookies.get(FLOW_COOKIE)?.httpOnly, true);
  const flow = cookie(start, FLOW_COOKIE);

  const rejected = await finishCareSource(request(`${callbackPath}?state=${"x".repeat(43)}&code=fixture-code`, { cookie: flow }));
  assert.match(rejected.headers.get("location")!, /connection=unavailable$/);
  assert.equal(rejected.cookies.get(CODE_COOKIE), undefined);

  const declined = await finishCareSource(request(`${callbackPath}?state=${state}&error=access_denied`, { cookie: flow }));
  assert.match(declined.headers.get("location")!, /connection=declined$/);

  const callback = await finishCareSource(request(`${callbackPath}?state=${state}&code=fixture-code`, { cookie: flow }));
  assert.equal(callback.headers.get("location"), `${COVERAGE_ORIGIN}/verify/my-coverage?connection=ready`);
  assert.equal(callback.cookies.get(FLOW_COOKIE)?.maxAge, 0);
  assert.equal(callback.cookies.get(CODE_COOKIE)?.sameSite, "strict");
  assert.doesNotMatch(callback.headers.get("set-cookie")!, /fixture-code/);

  const vendor = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    if (String(input).endsWith("/smart/auth/token")) {
      assert.equal(String(new URLSearchParams(init?.body as URLSearchParams).get("code")), "fixture-code");
      const verifier = (init?.body as URLSearchParams).get("code_verifier")!;
      assert.equal(createHash("sha256").update(verifier).digest("base64url"), auth.searchParams.get("code_challenge"));
      return Response.json({ access_token: "fixture-bearer", token_type: "Bearer", patient: "test-member" });
    }
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, `${CARESOURCE_FHIR_BASE}/Coverage`);
    assert.equal(url.searchParams.get("patient"), "test-member");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-bearer");
    return Response.json(bundle(coverage()));
  });
  const code = cookie(callback, CODE_COOKIE);
  const validResult = await returnCareSourceResult(request(resultPath, { origin: COVERAGE_ORIGIN, cookie: code, post: true }));
  assert.equal(validResult.status, 200);
  const payload = await validResult.text();
  assert.match(payload, /Ohio fixture plan/);
  assert.doesNotMatch(payload, /test-member|fixture-bearer|private-fixture|fixture-code/);
  assert.equal(validResult.cookies.get(CODE_COOKIE)?.maxAge, 0);
  assert.equal(validResult.headers.get("cache-control"), "private, no-store");
  assert.equal(vendor.mock.callCount(), 2);

  const foreignResult = await returnCareSourceResult(request(resultPath, { origin: "https://example.invalid", cookie: code, post: true }));
  assert.equal(foreignResult.status, 403);
  const first = CODE_COOKIE.length + 9;
  const modified = code.slice(0, first) + (code[first] === "x" ? "y" : "x") + code.slice(first + 1);
  const invalid = await returnCareSourceResult(request(resultPath, { origin: COVERAGE_ORIGIN, cookie: modified, post: true }));
  assert.equal(invalid.status, 502);
  assert.equal(vendor.mock.callCount(), 2);
});
