import assert from "node:assert/strict";
import { test } from "node:test";

import { POST as searchDrugs } from "@/app/api/drugs/autocomplete/route";
import { POST as searchProviders } from "@/app/api/providers/autocomplete/route";

function request(body: unknown, path: string) {
  return new Request(`https://affinity.pwr-labs.ai${path}?q=ignored-query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("drug search reads the body, not a URL query", async () => {
  const response = await searchDrugs(request({ q: "a" }, "/api/drugs/autocomplete"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
});

test("provider search reads the body, not a URL query", async () => {
  const response = await searchProviders(request({ q: "a", zip: "44106" }, "/api/providers/autocomplete"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
});

test("autocomplete rejects malformed JSON before an upstream call", async () => {
  for (const handler of [searchDrugs, searchProviders]) {
    const response = await handler(new Request("https://affinity.pwr-labs.ai/api/search", {
      method: "POST", body: "{", headers: { "content-type": "application/json" },
    }));
    assert.equal(response.status, 400);
  }
});
