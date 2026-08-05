import assert from "node:assert/strict";
import test from "node:test";

import {
  isStandalonePartDContract,
  pdpRegionCodeForState,
  rankPartDShortlist,
  type PartDShortlistDrugInput,
  type PartDShortlistPlanInput,
} from "@/lib/partd/shortlist";

const plans: PartDShortlistPlanInput[] = [
  {
    contractId: "S1000",
    planId: "001",
    segmentId: "000",
    contractYear: 2026,
    planName: "Complete Restricted",
    formularyId: "F1",
    state: "OH",
  },
  {
    contractId: "S2000",
    planId: "001",
    segmentId: "000",
    contractYear: 2026,
    planName: "Complete Open",
    formularyId: "F2",
    state: "OH",
  },
  {
    contractId: "S3000",
    planId: "001",
    segmentId: "000",
    contractYear: 2026,
    planName: "Partial",
    formularyId: "F3",
    state: "OH",
  },
  {
    contractId: "H4000",
    planId: "001",
    segmentId: "000",
    contractYear: 2026,
    planName: "Medicare Advantage",
    formularyId: "F4",
    state: "OH",
  },
];

const formularyDrugs: PartDShortlistDrugInput[] = [
  {
    formularyId: "F1",
    rxcui: "111",
    tier: 1,
    priorAuthorization: true,
    stepTherapy: false,
    quantityLimit: false,
  },
  {
    formularyId: "F1",
    rxcui: "222",
    tier: 2,
    priorAuthorization: false,
    stepTherapy: false,
    quantityLimit: false,
  },
  {
    formularyId: "F2",
    rxcui: "111",
    tier: 2,
    priorAuthorization: false,
    stepTherapy: false,
    quantityLimit: false,
  },
  {
    formularyId: "F2",
    rxcui: "222",
    tier: 3,
    priorAuthorization: false,
    stepTherapy: false,
    quantityLimit: false,
  },
  {
    formularyId: "F3",
    rxcui: "111",
    tier: 1,
    priorAuthorization: false,
    stepTherapy: false,
    quantityLimit: false,
  },
  {
    formularyId: "F4",
    rxcui: "111",
    tier: 1,
    priorAuthorization: false,
    stepTherapy: false,
    quantityLimit: false,
  },
  {
    formularyId: "F4",
    rxcui: "222",
    tier: 1,
    priorAuthorization: false,
    stepTherapy: false,
    quantityLimit: false,
  },
];

test("standalone Part D discovery includes S contracts and excludes Medicare Advantage contracts", () => {
  assert.equal(isStandalonePartDContract("S5810"), true);
  assert.equal(isStandalonePartDContract("H5253"), false);
  assert.equal(isStandalonePartDContract("S123"), false);
});

test("CMS PDP regions map states and territories to the correct service area", () => {
  assert.equal(pdpRegionCodeForState("OH"), "14");
  assert.equal(pdpRegionCodeForState("dc"), "5");
  assert.equal(pdpRegionCodeForState("PR"), "38");
  assert.equal(pdpRegionCodeForState("XX"), null);
});

test("Part D shortlist ranks coverage first, then restriction burden, then average tier", () => {
  const ranked = rankPartDShortlist({ plans, formularyDrugs, rxcuis: ["111", "222"] });
  assert.deepEqual(
    ranked.map((plan) => plan.planName),
    ["Complete Open", "Complete Restricted", "Partial"],
  );
  assert.equal(ranked[0].listedCount, 2);
  assert.equal(ranked[0].restrictedDrugCount, 0);
  assert.equal(ranked[0].averageTier, 2.5);
  assert.equal(ranked[1].restrictedDrugCount, 1);
});

test("Part D shortlist treats a drug absent from an indexed formulary as not listed", () => {
  const [partial] = rankPartDShortlist({
    plans: [plans[2]],
    formularyDrugs,
    rxcuis: ["111", "222"],
  });
  assert.deepEqual(partial.drugs, [
    {
      rxcui: "111",
      value: "yes",
      tier: 1,
      priorAuthorization: false,
      stepTherapy: false,
      quantityLimit: false,
    },
    { rxcui: "222", value: "no", tier: null },
  ]);
});

test("Part D shortlist produces one medication row per unique requested RxCUI", () => {
  const [result] = rankPartDShortlist({
    plans: [plans[1]],
    formularyDrugs,
    rxcuis: ["111", "111", "222"],
  });
  assert.equal(result.medicationCount, 2);
  assert.deepEqual(
    result.drugs.map((drug) => drug.rxcui),
    ["111", "222"],
  );
});
