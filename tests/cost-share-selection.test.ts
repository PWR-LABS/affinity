import assert from "node:assert/strict";
import test from "node:test";

import { pickVerifiedCostShare } from "@/lib/decision/cost-share";
import type { MarketplaceCostShare } from "@/lib/marketplace/types";

const combined = {
  amount: 4_200,
  type: "Combined Medical and Drug EHB Deductible",
  network_tier: "In-Network",
  family_cost: "Individual",
};

test("uses an explicit in-network individual combined amount", () => {
  assert.equal(pickVerifiedCostShare([combined]), 4_200);
  assert.equal(pickVerifiedCostShare([combined, { ...combined, csr: "Silver 87" }]), 4_200);
});

test("never substitutes family or out-of-network amounts", () => {
  assert.equal(pickVerifiedCostShare([{ ...combined, family_cost: "Family", amount: 8_400 }]), undefined);
  assert.equal(pickVerifiedCostShare([{ ...combined, network_tier: "Out-of-Network", amount: 9_000 }]), undefined);
  assert.equal(pickVerifiedCostShare([
    { ...combined, family_cost: "Family", amount: 8_400 },
    { ...combined, network_tier: "Out-of-Network", amount: 9_000 },
  ]), undefined);
});

test("missing scope, medical-only amount, or invalid amount stays unknown", () => {
  assert.equal(pickVerifiedCostShare([{ ...combined, network_tier: undefined }]), undefined);
  assert.equal(pickVerifiedCostShare([{ ...combined, family_cost: undefined }]), undefined);
  assert.equal(pickVerifiedCostShare([{ ...combined, type: "Medical Only Deductible" }]), undefined);
  assert.equal(pickVerifiedCostShare([{ ...combined, amount: Number.NaN }]), undefined);
  assert.equal(pickVerifiedCostShare([{ ...combined, amount: -1 }]), undefined);
  assert.equal(pickVerifiedCostShare([null, "bad"] as unknown as MarketplaceCostShare[]), undefined);
  assert.equal(pickVerifiedCostShare(undefined), undefined);
});

test("conflicting source variants stay unknown rather than first-wins", () => {
  assert.equal(pickVerifiedCostShare([
    combined,
    { ...combined, amount: 2_100, csr: "Silver 87" },
  ]), undefined);
});
