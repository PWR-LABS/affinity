/** One deduplicated review issue; unchanged reports do not produce repeated messages. */
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_REPOSITORY !== "PWR-LABS/affinity") throw new Error("workflow_only");
  const report = JSON.parse(fs.readFileSync("tmp/guidance-watch-report.json", "utf8"));
  const title = "Coverage guidance source review required";
  const body = `An automated source watch found content changes, unavailable sources, or an overdue policy review. No policy text was automatically rewritten.\n\nLast policy review: ${report.lastPolicyReview}. Review overdue: ${report.reviewOverdue}.\n\n${report.records.map((record) => `- ${record.id}: ${record.status} (${record.url})`).join("\n")}\n\nReport fingerprint: ${report.fingerprint}\n\nReview the official sources, update the applicable guidance, and explicitly record a new reviewed date and observation baseline. A fetch timestamp is not a policy review.`;
  const args = ["--repo", "PWR-LABS/affinity"];
  const existing = JSON.parse(execFileSync("gh", ["issue", "list", ...args, "--state", "open", "--search", `in:title \"${title}\"`, "--json", "number,title,body,author"], { encoding: "utf8" }));
  const owned = existing.find((issue) => issue.title === title && ["github-actions[bot]", "github-actions"].includes(issue.author?.login));
  if (!report.needsReview) { if (owned) execFileSync("gh", ["issue", "close", String(owned.number), ...args], { stdio: "inherit" }); return; }
  if (owned?.body?.trimEnd() === body.trimEnd()) return;
  fs.writeFileSync("tmp/guidance-issue.md", body + "\n");
  execFileSync("gh", owned ? ["issue", "edit", String(owned.number), ...args, "--body-file", "tmp/guidance-issue.md"] : ["issue", "create", ...args, "--title", title, "--body-file", "tmp/guidance-issue.md"], { stdio: "inherit" });
}
try { main(); } catch { console.error("guidance_review_notification_failed"); process.exitCode = 1; }
