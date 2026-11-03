import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_MARKETPLACE_PLAN_YEAR, MARKETPLACE_CATALOG, SUPPORTED_MARKETPLACE_PLAN_YEARS, parseMarketplacePlanYear, stateBasedMarketplace, StateNotSupportedError, UnsupportedMarketplacePlanYearError } from "@/lib/marketplace/states";
import { STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";

// These assertions describe the frozen historical fixture, never the generated production catalog.

test("full-platform 2026 routing matches all 21 CMS-listed state exchanges", () => {
  const cmsFullPlatform = ["CA", "CO", "CT", "DC", "GA", "ID", "IL", "KY", "ME", "MD", "MA", "MN", "NV", "NJ", "NM", "NY", "PA", "RI", "VT", "VA", "WA"].sort();
  const routed = STATE_MEDICAID_RESOURCES.map((resource) => resource.code).filter((code) => stateBasedMarketplace(code, 2026)).sort();
  assert.deepEqual(routed, cmsFullPlatform);
  assert.equal(stateBasedMarketplace("IL", 2026)?.state, "Illinois");
  assert.ok(stateBasedMarketplace("IL", 2026)?.url.endsWith(".gov"));
  for (const federalPlatform of ["AR", "OR", "OK"]) assert.equal(stateBasedMarketplace(federalPlatform, 2026), undefined);
});

test("identifies state-based marketplaces and routes to their own exchange", () => {
  const ca = stateBasedMarketplace("CA");
  assert.ok(ca, "California is a state-based marketplace");
  assert.ok(ca.name.trim());
  assert.ok(ca.url.trim());
  assert.equal(stateBasedMarketplace("NY")?.state, "New York");
});

test("federal-platform states return undefined (the API serves them)", () => {
  // Ohio, Texas, Florida — all on HealthCare.gov, so the tool handles them directly.
  assert.equal(stateBasedMarketplace("OH"), undefined);
  assert.equal(stateBasedMarketplace("TX"), undefined);
  assert.equal(stateBasedMarketplace("FL"), undefined);
});

test("is case-insensitive and tolerates missing input", () => {
  assert.deepEqual(stateBasedMarketplace("ca"), stateBasedMarketplace("CA"));
  assert.equal(stateBasedMarketplace(undefined), undefined);
  assert.equal(stateBasedMarketplace(""), undefined);
});

test("StateNotSupportedError carries the marketplace for a clear redirect", () => {
  const m = stateBasedMarketplace("WA")!;
  const err = new StateNotSupportedError(m);
  assert.equal(err.name, "StateNotSupportedError");
  assert.equal(err.marketplace.url, "wahealthplanfinder.org");
  assert.match(err.message, /Washington/);
});

test("2027 routes all 22 CMS-listed state marketplaces while preserving federal-platform states", () => {
  const cms2027 = ["CA", "CO", "CT", "DC", "GA", "ID", "IL", "KY", "ME", "MD", "MA", "MN", "NV", "NJ", "NM", "NY", "OR", "PA", "RI", "VT", "VA", "WA"].sort();
  const routed = STATE_MEDICAID_RESOURCES.map((resource) => resource.code).filter((code) => stateBasedMarketplace(code, 2027)).sort();
  assert.deepEqual(routed, cms2027);
  assert.equal(stateBasedMarketplace("OR", 2026), undefined);
  assert.equal(stateBasedMarketplace("or", 2027)?.url, "explorehealthor.gov");
  for (const state of ["AR", "OK", "OH", "TX", "FL"]) assert.equal(stateBasedMarketplace(state, 2027), undefined);
});

test("only source-validated plan years are accepted, with the official default", () => {
  assert.equal(DEFAULT_MARKETPLACE_PLAN_YEAR, MARKETPLACE_CATALOG.defaultYear);
  assert.equal(parseMarketplacePlanYear(undefined), DEFAULT_MARKETPLACE_PLAN_YEAR);
  for (const year of [2026, 2027]) {
    assert.equal(parseMarketplacePlanYear(year), year);
    assert.equal(parseMarketplacePlanYear(String(year)), year);
  }
  const unknownYear = Math.max(...SUPPORTED_MARKETPLACE_PLAN_YEARS) + 1;
  for (const invalid of [2025, unknownYear, 2027.5, Number.NaN, Infinity, null, true, false, "", " ", "year2027", [], {}, "2027.0"]) assert.equal(parseMarketplacePlanYear(invalid), undefined);
  for (const invalid of [2025, unknownYear, Number.NaN, 2027.5]) assert.throws(() => stateBasedMarketplace("OH", invalid), UnsupportedMarketplacePlanYearError);
});
