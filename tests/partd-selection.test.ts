import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PARTD_DRUGS,
  addPartDDrugSelection,
  decodePartDPlanSelection,
  encodePartDPlanSelection,
} from "@/lib/partd/selection";

test("Part D plan selections round-trip without losing the segment or geography", () => {
  const plan = {
    contractId: "S5810",
    planId: "001",
    segmentId: "2",
    contractYear: 2026,
    planName: "Synthetic Value Rx",
    state: "OH",
  };
  assert.deepEqual(decodePartDPlanSelection(encodePartDPlanSelection(plan)), plan);
});

test("Part D plan selections reject malformed or incomplete data", () => {
  assert.equal(decodePartDPlanSelection("not-json"), null);
  assert.equal(
    decodePartDPlanSelection(
      JSON.stringify({
        contractId: "bad",
        planId: "001",
        segmentId: "0",
        contractYear: 2026,
        planName: "Synthetic Value Rx",
      }),
    ),
    null,
  );
});

test("Part D medication lists append exact products and ignore duplicate RxCUIs", () => {
  const first = addPartDDrugSelection([], { rxcui: "861007", label: "metFORMIN 500 mg Tab" });
  const duplicate = addPartDDrugSelection(first, { rxcui: "861007", label: "Duplicate label" });
  const second = addPartDDrugSelection(duplicate, { rxcui: "617310", label: "Atorvastatin 20 mg Tab" });

  assert.deepEqual(second, [
    { rxcui: "861007", label: "metFORMIN 500 mg Tab" },
    { rxcui: "617310", label: "Atorvastatin 20 mg Tab" },
  ]);
});

test("Part D medication lists reject invalid products and stop at the batch limit", () => {
  assert.deepEqual(addPartDDrugSelection([], { rxcui: "bad", label: "Invalid" }), []);

  const full = Array.from({ length: MAX_PARTD_DRUGS }, (_, index) => ({
    rxcui: String(100000 + index),
    label: `Synthetic drug ${index + 1}`,
  }));
  assert.equal(addPartDDrugSelection(full, { rxcui: "999999", label: "One too many" }), full);
});
