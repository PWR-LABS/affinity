import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFingerprint, GUIDANCE_FINGERPRINT_VERSION, watchGuidance } from "../scripts/watch-guidance";
import { MEDICAID_GUIDANCE_REVIEWED_DAY, medicaidGuidanceCurrent } from "@/lib/medicaid/federal";
import { publicationPlan } from "../scripts/publish-catalog-refresh.cjs";
import { snapshotMatches } from "../scripts/verify-catalog-publication.cjs";
import { ownedGuidanceIssue } from "../scripts/report-guidance-watch.cjs";

const REVIEWED_AT = Date.parse(`${MEDICAID_GUIDANCE_REVIEWED_DAY}T00:00:00Z`);
const DAY = 24 * 60 * 60 * 1000;

test("guidance notifications reuse the actual GitHub Actions author identity without adopting someone else's issue", () => {
  const title = "Coverage guidance source review required";
  const issues = [
    { number: 1, title, author: { is_bot: false, login: "github-actions" } },
    { number: 2, title, author: { is_bot: true, login: "other-bot" } },
    { number: 3, title: "Another issue", author: { is_bot: true, login: "app/github-actions" } },
    { number: 4, title, author: { is_bot: true, login: "app/github-actions" } },
  ];
  assert.equal(ownedGuidanceIssue(issues, title)?.number, 4);
  assert.equal(ownedGuidanceIssue(issues.slice(0, 3), title), undefined);
});

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

test("application and policy-document link destinations are meaningful source content", () => {
  const bytes = (link: string) => new TextEncoder().encode(`<main><p>${"Official guidance. ".repeat(20)}</p>${link}</main>`);
  for (const [first, second] of [
    ['<a href="https://old.example.gov/apply">Apply</a>', '<a href="https://new.example.gov/apply">Apply</a>'],
    ["<a href='old-policy.pdf'>Policy document</a>", "<a href='replacement.pdf'>Policy document</a>"],
    ["<area href=/old-application>", "<area href=/new-application>"],
    ["<area href=/application>", "<area href=/application/>"],
  ]) assert.notEqual(contentFingerprint(bytes(first), "text/html"), contentFingerprint(bytes(second), "text/html"));
});

test("link normalization respects entities, relative URLs, base URLs and excluded page chrome", () => {
  const text = "Official guidance. ".repeat(20);
  const hash = (markup: string) => contentFingerprint(new TextEncoder().encode(markup), "text/html", "https://source.example.gov/directory/");
  const first = `<main>${text}<a href='/apply?a=1&amp;b=2'>Apply</a></main>`;
  assert.equal(hash(first), hash(`<main><nav><a href='/changed-menu'>Menu</a></nav>${text}<a data-note=" href='decoy'" href="https://source.example.gov/apply?a=1&b=2">Apply</a></main>`));
  assert.notEqual(hash(`<base href='/old/'><main>${text}<a href='policy.pdf'>Policy</a></main>`), hash(`<base href='/new/'><main>${text}<a href='policy.pdf'>Policy</a></main>`));
});

test("a link-only change raises review even while the policy review date is current", async () => {
  const transport = (href: string) => (async () => new Response(`<main>${"Official guidance. ".repeat(20)}<a href="${href}">Apply</a></main>`, { headers: { "content-type": "text/html" } })) as typeof fetch;
  const first = await watchGuidance({ fetchImpl: transport("https://old.example.gov/apply"), now: REVIEWED_AT + DAY });
  const second = await watchGuidance({ fetchImpl: transport("https://new.example.gov/apply"), baseline: first, now: REVIEWED_AT + 2 * DAY });
  assert.equal(second.reviewOverdue, false);
  assert.equal(second.needsReview, true);
  assert.ok(second.records.every(({ status }) => status === "content_changed"));
});

test("legacy fingerprints require an explicit baseline migration without renewing policy review", async () => {
  const fetchImpl = (async () => new Response(`<main>${"Official guidance. ".repeat(20)}</main>`, { headers: { "content-type": "text/html" } })) as typeof fetch;
  const first = await watchGuidance({ fetchImpl, now: REVIEWED_AT + DAY });
  const next = await watchGuidance({ fetchImpl, baseline: { records: first.records }, now: REVIEWED_AT + 2 * DAY });
  assert.equal(next.fingerprintVersion, GUIDANCE_FINGERPRINT_VERSION);
  assert.equal(next.baselineVersion, null);
  assert.equal(next.needsReview, true);
  assert.ok(next.records.every(({ status }) => status === "baseline_refresh_required"));
  assert.equal(next.lastPolicyReview, first.lastPolicyReview);
});

test("a fetch or matching observation hash never renews a policy review", async () => {
  const fetchImpl = (async () => new Response(`<main>${"Official guidance. ".repeat(20)}</main>`, { headers: { "content-type": "text/html" } })) as typeof fetch;
  const first = await watchGuidance({ fetchImpl, now: REVIEWED_AT + 31 * DAY });
  const repeat = await watchGuidance({ fetchImpl, baseline: first, now: REVIEWED_AT + 32 * DAY });
  assert.ok(repeat.records.every((record) => record.status === "unchanged_observation"));
  assert.equal(repeat.reviewOverdue, true);
  assert.equal(repeat.needsReview, true);
  assert.equal(medicaidGuidanceCurrent(REVIEWED_AT + 31 * DAY), false);
});

test("policy review expires at thirty days and rejects a future review date", () => {
  assert.equal(medicaidGuidanceCurrent(REVIEWED_AT - 1), false);
  assert.equal(medicaidGuidanceCurrent(REVIEWED_AT), true);
  assert.equal(medicaidGuidanceCurrent(REVIEWED_AT + 30 * DAY - 1), true);
  assert.equal(medicaidGuidanceCurrent(REVIEWED_AT + 30 * DAY), false);
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
