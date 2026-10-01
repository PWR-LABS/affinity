import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCounty } from "@/lib/marketplace/geography";
import type { MarketplaceCounty } from "@/lib/marketplace/types";

const cuyahoga: MarketplaceCounty = { fips: "39035", name: "Cuyahoga", state: "OH", zipcode: "44106" };
const harris: MarketplaceCounty = { fips: "48201", name: "Harris County", state: "TX", zipcode: "77449" };
const fortBend: MarketplaceCounty = { fips: "48157", name: "Fort Bend County", state: "TX", zipcode: "77449" };
const florida: MarketplaceCounty = { fips: "12086", name: "Miami-Dade", state: "FL", zipcode: "33101" };

test("county resolver accepts a unique rating county, even if the source repeats it", () => {
  assert.deepEqual(resolveCounty([cuyahoga], "OH"), { status: "unique", county: cuyahoga });
  assert.deepEqual(resolveCounty([cuyahoga, cuyahoga], "OH"), { status: "unique", county: cuyahoga });
});

test("county resolver never chooses the first of two candidate rating counties", () => {
  assert.deepEqual(resolveCounty([harris, fortBend], "TX"), { status: "ambiguous" });
  assert.deepEqual(resolveCounty([fortBend, harris]), { status: "ambiguous" });
});

test("requested state narrows cross-state candidates and mismatches fail closed", () => {
  assert.deepEqual(resolveCounty([florida, cuyahoga], "OH"), { status: "unique", county: cuyahoga });
  assert.deepEqual(resolveCounty([florida], "OH"), { status: "state_mismatch" });
  assert.deepEqual(resolveCounty([], "OH"), { status: "not_found" });
});
