import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "@/app/api/health/route";
import { releaseIdentity } from "@/lib/deploy/release";

test("release identity accepts only a commit SHA and a safe branch", () => {
  const sha = "A".repeat(40);
  assert.deepEqual(releaseIdentity(sha, "main"), { commit: sha.toLowerCase(), branch: "main" });
  assert.deepEqual(releaseIdentity("not-a-sha", "main\nsecret"), { commit: null, branch: null });
  assert.deepEqual(releaseIdentity(undefined, undefined), { commit: null, branch: null });
});

test("health reports the runtime release identity without caching it", async () => {
  const previous = {
    commit: process.env.RENDER_GIT_COMMIT,
    branch: process.env.RENDER_GIT_BRANCH,
    database: process.env.DATABASE_URL,
  };
  const sha = "b".repeat(40);
  try {
    process.env.RENDER_GIT_COMMIT = sha;
    process.env.RENDER_GIT_BRANCH = "main";
    delete process.env.DATABASE_URL;
    const response = await GET(new Request("http://localhost/api/health"));
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.deepEqual(body.release, { commit: sha, branch: "main" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    for (const [key, value] of Object.entries({
      RENDER_GIT_COMMIT: previous.commit,
      RENDER_GIT_BRANCH: previous.branch,
      DATABASE_URL: previous.database,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
