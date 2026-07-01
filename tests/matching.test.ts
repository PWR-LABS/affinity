import assert from "node:assert/strict";
import { test } from "node:test";

import { matchPlan, matchProfile, statusFor, type PlanCoverageInputs } from "@/lib/matching/engine";
import type { MatchProfileInput } from "@/lib/matching/types";
import type { MarketplaceDrugCoverage, MarketplaceProviderCoverage } from "@/lib/marketplace/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import { makeCoverageAnswer, type Tristate } from "@/lib/provenance";
import { reconcileClaim } from "@/lib/reconcile";

const FETCH = "2026-06-17T12:00:00.000Z";

function reconciled(apiVal: Tristate, mrfVal: Tristate) {
  return reconcileClaim({
    kind: "PROVIDER",
    subjectKey: "1",
    planId: "P",
    api: makeCoverageAnswer({ value: apiVal, source: "MARKETPLACE_API", fetchedAt: FETCH, confidence: 0.6 }),
    mrf: makeCoverageAnswer({ value: mrfVal, source: "ISSUER_MRF", fetchedAt: FETCH, confidence: 0.6 }),
  });
}

test("statusFor maps every verdict to an honest coverage status", () => {
  assert.equal(statusFor(reconciled("yes", "yes")), "covered");
  assert.equal(statusFor(reconciled("no", "no")), "not_covered");
  assert.equal(statusFor(reconciled("yes", "no")), "disputed");
  assert.equal(statusFor(reconciled("yes", "unknown")), "covered_unverified");
  assert.equal(statusFor(reconciled("no", "unknown")), "not_covered_unverified");
  assert.equal(statusFor(reconciled("unknown", "yes")), "covered_unverified");
  assert.equal(statusFor(reconciled("unknown", "unknown")), "unknown");
});

function planInputs(planId: string, apiProv: MarketplaceProviderCoverage[], apiDrug: MarketplaceDrugCoverage[]): PlanCoverageInputs {
  return {
    planId,
    planLabel: planId,
    apiProviders: new Map(apiProv.map((c) => [c.npi, c])),
    apiDrugs: new Map(apiDrug.map((c) => [c.rxcui, c])),
  };
}

test("matchPlan rolls up per-subject statuses into a coverage summary", () => {
  const profile: MatchProfileInput = { doctors: [{ npi: "1" }, { npi: "2" }], medications: [{ rxcui: "D" }] };
  const dataset = datasetFromRecords(
    [{ npi: "1", plans: [{ plan_id: "P" }], last_updated_on: "2026-06-17" }], // doctor 1 listed → AGREE
    [{ rxnorm_id: "D", plans: [{ plan_id: "P", drug_tier: "GENERIC" }], last_updated_on: "2026-06-17" }],
    FETCH,
  );
  const m = matchPlan(
    profile,
    planInputs("P", [{ npi: "1", coverage: "Covered" }, { npi: "2", coverage: "Covered" }], [{ rxcui: "D", coverage: "Covered" }]),
    dataset,
    FETCH,
  );
  // doctor 1 = covered (AGREE), doctor 2 = covered_unverified (MRF absent), drug D = covered.
  assert.equal(m.summary.doctorsCovered, 2);
  assert.equal(m.summary.doctorsTotal, 2);
  assert.equal(m.summary.drugsOnFormulary, 1);
  assert.ok(m.summary.confirmList.some((s) => s.subjectKey === "2")); // one-sided → confirm
});

test("matchProfile ranks better coverage first", () => {
  const profile: MatchProfileInput = { doctors: [{ npi: "1" }], medications: [] };
  const dataset = datasetFromRecords([{ npi: "1", plans: [{ plan_id: "GOOD" }], last_updated_on: "2026-06-17" }], [], FETCH);
  const ranked = matchProfile(
    profile,
    [
      planInputs("GOOD", [{ npi: "1", coverage: "Covered" }], []),
      planInputs("BAD", [], []), // no API coverage; MRF lists the doctor only for GOOD → not covered here
    ],
    dataset,
    FETCH,
  );
  assert.equal(ranked[0].planId, "GOOD");
  assert.ok(ranked[0].summary.matchScore > ranked[1].summary.matchScore);
});
