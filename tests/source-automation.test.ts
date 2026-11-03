import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFingerprint, watchGuidance } from "../scripts/watch-guidance";
import { medicaidGuidanceCurrent } from "@/lib/medicaid/federal";
import { publicationPlan } from "../scripts/publish-catalog-refresh.cjs";
import { snapshotMatches } from "../scripts/verify-catalog-publication.cjs";

test("automatic publisher rejects other branches, repositories, events, code edits and a moved base", () => {
  const base = { event: "schedule", ref: "refs/heads/main", repository: "PWR-LABS/affinity", sourceSha: "a".repeat(40), remoteSha: "a".repeat(40), changedFiles: ["src/lib/marketplace/catalog-data.json"], autoPublish: "true" };
  assert.equal(publicationPlan(base), "verified_catalog_publish");
  assert.equal(publicationPlan({ ...base, autoPublish: "false" }), "review_proposal");
  for (const patch of [{ ref: "refs/heads/feature" }, { repository: "other/repo" }, { event: "pull_request" }, { changedFiles: [...base.changedFiles, "src/app/page.tsx"] }, { remoteSha: "b".repeat(40) }]) assert.throws(() => publicationPlan({ ...base, ...patch }));
});

test("content watcher ignores page chrome but detects meaningful main-content changes", () => {
  const text = "Official eligibility and renewal guidance. ".repeat(5);
  const bytes = (body: string) => new TextEncoder().encode(body);
  const first = contentFingerprint(bytes(`<header>one</header><main><nav>one</nav><p>${text}</p></main>`), "text/html");
  assert.equal(first, contentFingerprint(bytes(`<header>two</header><main><nav>two</nav><p>${text}</p></main>`), "text/html"));
  assert.notEqual(first, contentFingerprint(bytes(`<main>${text} New renewal instruction.</main>`), "text/html"));
  assert.throws(() => contentFingerprint(bytes("<body>Access denied</body>"), "text/html"));
});

test("a fetch or matching observation hash never renews a policy review", async () => {
  const fetchImpl = (async () => new Response(`<main>${"Official guidance. ".repeat(20)}</main>`, { headers: { "content-type": "text/html" } })) as typeof fetch;
  const first = await watchGuidance({ fetchImpl, now: Date.parse("2026-11-03T12:00:00Z") });
  const repeat = await watchGuidance({ fetchImpl, baseline: first, now: Date.parse("2026-11-04T12:00:00Z") });
  assert.ok(repeat.records.every((record) => record.status === "unchanged_observation"));
  assert.equal(repeat.reviewOverdue, true);
  assert.equal(repeat.needsReview, true);
  assert.equal(medicaidGuidanceCurrent(Date.parse("2026-11-03T12:00:00Z")), false);
});

test("a Git checkpoint alone cannot pass deployed catalog verification", () => {
  const commit = "a".repeat(40);
  const catalog = { checkedAt: "2026-11-03T12:00:00Z", defaultYear: 2027, years: { "2026": {}, "2027": {} } };
  const health = { status: "ok", release: { commit, branch: "main" } };
  const status = { marketplace: { status: "current", checkedAt: catalog.checkedAt, defaultYear: 2027, supportedYears: [2026, 2027] } };
  assert.equal(snapshotMatches(health, status, commit, catalog), true);
  assert.equal(snapshotMatches({ ...health, release: { commit: "b".repeat(40), branch: "main" } }, status, commit, catalog), false);
  assert.equal(snapshotMatches(health, { marketplace: { ...status.marketplace, checkedAt: "old" } }, commit, catalog), false);
  assert.equal(snapshotMatches(health, { marketplace: { ...status.marketplace, status: "stale" } }, commit, catalog), false);
});
