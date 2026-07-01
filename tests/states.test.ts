import assert from "node:assert/strict";
import { test } from "node:test";

import { stateBasedMarketplace, StateNotSupportedError } from "@/lib/marketplace/states";

test("identifies state-based marketplaces and routes to their own exchange", () => {
  const ca = stateBasedMarketplace("CA");
  assert.ok(ca, "California is a state-based marketplace");
  assert.equal(ca.name, "Covered California");
  assert.match(ca.url, /coveredca\.com/);
  assert.equal(stateBasedMarketplace("NY")?.name, "NY State of Health");
});

test("federal-platform states return undefined (the API serves them)", () => {
  // Ohio, Texas, Florida — all on HealthCare.gov, so the tool handles them directly.
  assert.equal(stateBasedMarketplace("OH"), undefined);
  assert.equal(stateBasedMarketplace("TX"), undefined);
  assert.equal(stateBasedMarketplace("FL"), undefined);
});

test("is case-insensitive and tolerates missing input", () => {
  assert.equal(stateBasedMarketplace("ca")?.name, "Covered California");
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
