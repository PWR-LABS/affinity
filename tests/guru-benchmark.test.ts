import assert from "node:assert/strict";
import { test } from "node:test";
import { cases } from "../scripts/guru-benchmark/cases";
import { models, parseCap, plan, requestBody, reserve, score, usageMicro } from "../scripts/guru-benchmark/core";

test("balanced benchmark contains every requested model in every case and repetition", () => {
  const jobs = plan(2);
  assert.equal(jobs.length, cases.length * 3 * 2);
  assert.equal(new Set(jobs.map(j => j.key)).size, jobs.length);
  for (const item of cases) for (const model of models) assert.equal(jobs.filter(j => j.item.id === item.id && j.model === model).length, 2);
});

test("model requests exclude expected answers and review rubrics", () => {
  const item = { ...cases[0], expected: { hidden: "GOLD_SENTINEL" }, review: "REVIEW_SENTINEL" };
  const body = JSON.stringify(requestBody(models[0], item));
  assert.ok(!body.includes("GOLD_SENTINEL"));
  assert.ok(!body.includes("REVIEW_SENTINEL"));
  assert.ok(body.includes('"store":false'));
});

test("cost cap rejects invalid amounts and prevents dispatch beyond reservations", () => {
  for (const value of [undefined, "NaN", "Infinity", "-1", "0", "5.01", "1e1", ".50"]) assert.throws(() => parseCap(value));
  assert.equal(parseCap("2.50"), 2500000);
  assert.equal(reserve(90, 10, 100), 100);
  assert.throws(() => reserve(90, 11, 100));
  assert.throws(() => reserve(NaN, 1, 100));
  assert.throws(() => reserve(0, -1, 100));
});

test("tool scoring rejects correct tool with corrupted plan year or invented arguments", () => {
  const item = cases.find(x => x.id === "partd-verify-tool")!;
  const response = (args: object) => ({ status: "completed", output: [{ type: "function_call", name: item.tool!.name, arguments: JSON.stringify(args) }] });
  assert.equal(score(item, response(item.tool!.args)).passed, true);
  assert.equal(score(item, response({ ...item.tool!.args, year: 2026 })).passed, false);
  assert.equal(score(item, response({ ...item.tool!.args, enroll: true })).passed, false);
});

test("structured scoring cannot promote missing provider evidence or invent a citation", () => {
  const item = cases.find(x => x.id === "provider-absent")!;
  const answer = { answer: "Unknown; confirm the exact plan.", route: "Coverage", coverage: "unknown", eligibility: "undetermined",
    evidenceIds: [item.evidence[0].id], annualPremium: null, deductible: null, confirmationRequired: true,
    publicationAllowed: false, state: null, year: null };
  const response = (value: object, status = "completed") => ({ status, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });
  assert.equal(score(item, response(answer)).passed, true);
  assert.equal(score(item, response({ ...answer, coverage: "listed" })).passed, false);
  assert.equal(score(item, response({ ...answer, evidenceIds: ["made-up"] })).passed, false);
  assert.equal(score(item, response(answer, "incomplete")).passed, false);
  assert.equal(score(item, response(answer)).semanticReview, "pending");
});

test("usage includes all reported output and malformed usage stays unresolved", () => {
  assert.equal(usageMicro("gpt-6.1-sol", { usage: { input_tokens: 4000, output_tokens: 600 } }), 16000);
  assert.equal(usageMicro("gpt-6.1-terra", { usage: { input_tokens: 4000, output_tokens: 600 } }), 8000);
  assert.equal(usageMicro("gpt-6-luna", { usage: { input_tokens: 4000, output_tokens: 600 } }), 800);
  assert.equal(usageMicro("gpt-6-luna", {}), null);
  assert.equal(usageMicro("gpt-6-luna", { usage: { input_tokens: -1, output_tokens: 1 } }), null);
});
