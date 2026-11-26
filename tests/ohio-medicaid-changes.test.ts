import assert from "node:assert/strict";
import { test } from "node:test";

import { OHIO_COVERAGE_GROUPS, ohioChangeGuidanceCurrent, ohioChangeResult } from "../src/lib/medicaid/ohio-changes";

test("the Ohio change check separates work exemptions from the renewal schedule", () => {
  const result = ohioChangeResult("expansion", "none");
  assert.match(result.renewal, /every six months/);
  assert.match(result.renewal, /official notice for your own renewal date/);
  assert.match(result.work, /exemption may apply to the work requirement/);
  assert.match(result.work, /may still need to renew every six months/);
  assert.doesNotMatch(ohioChangeResult("other", "none").renewal, /every six months/);
  assert.match(ohioChangeResult("unsure", "none").action, /View My Benefits/);
});

test("a renewal request or an adverse decision takes priority for every coverage group", () => {
  for (const group of ["expansion", "other", "unsure"] as const) {
    const request = ohioChangeResult(group, "request");
    const decision = ohioChangeResult(group, "decision");
    assert.match(request.next, /date on your notice/);
    assert.match(decision.action, /deadline to ask for a state hearing/);
    assert.equal(request.renewal, OHIO_COVERAGE_GROUPS[group].renewal);
    assert.equal(decision.work, OHIO_COVERAGE_GROUPS[group].work);
    assert.doesNotMatch(request.action + decision.action, /January 1|30 days/);
  }
});

test("Ohio policy screening has a bounded source review window", () => {
  const review = Date.parse("2026-11-26T00:00:00Z");
  const expiry = Date.parse("2026-12-26T00:00:00Z");
  assert.equal(ohioChangeGuidanceCurrent(review - 1), false);
  assert.equal(ohioChangeGuidanceCurrent(review), true);
  assert.equal(ohioChangeGuidanceCurrent(expiry - 1), true);
  assert.equal(ohioChangeGuidanceCurrent(expiry), false);
});
