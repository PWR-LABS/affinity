import assert from "node:assert/strict";
import { test } from "node:test";

import { premiumAmounts } from "@/lib/decision/premium";

test("annualized net premium uses twelve months of the displayed quote", () => {
  assert.deepEqual(premiumAmounts(410.4, 100, "Silver"), {
    grossMonthly: 410,
    netMonthly: 310,
    netAnnual: 3720,
  });
});

test("catastrophic plans do not receive premium tax credits", () => {
  assert.deepEqual(premiumAmounts(250, 400, "Catastrophic"), {
    grossMonthly: 250,
    netMonthly: 250,
    netAnnual: 3000,
  });
});

test("missing or invalid source premium stays unknown rather than becoming zero", () => {
  assert.deepEqual(premiumAmounts(undefined, 100, "Silver"), {});
  assert.deepEqual(premiumAmounts(-1, 100, "Silver"), {});
  assert.deepEqual(premiumAmounts(Number.NaN, 100, "Silver"), {});
});
