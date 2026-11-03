/** Narrow publication boundary for the reviewed scheduled workflow; never changes executable code. */
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const CATALOG = "src/lib/marketplace/catalog-data.json";

function publicationPlan({ event, ref, repository, sourceSha, remoteSha, changedFiles, autoPublish }) {
  if (!["schedule", "workflow_dispatch"].includes(event) || ref !== "refs/heads/main" || repository !== "PWR-LABS/affinity") throw new Error("unapproved_publication_context");
  if (!/^[a-f0-9]{40}$/.test(sourceSha || "") || sourceSha !== remoteSha) throw new Error("publication_base_changed");
  if (changedFiles.length !== 1 || changedFiles[0] !== CATALOG) throw new Error("publication_scope_exceeded");
  return autoPublish === "true" ? "verified_catalog_publish" : "review_proposal";
}
module.exports = { publicationPlan };

function main() {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("workflow_only");
  const report = JSON.parse(fs.readFileSync("tmp/catalog-refresh-report.json", "utf8"));
  if (report.status !== "verified") throw new Error("catalog_report_not_verified");
  if (!report.changed) { console.log("No material catalog change or receipt renewal due."); return; }
  const bytes = fs.readFileSync(CATALOG);
  const candidate = JSON.parse(bytes);
  const checked = Date.parse(candidate.checkedAt);
  const expires = Date.parse(candidate.expiresAt);
  if (!Number.isFinite(checked) || checked > Date.now() + 60_000 || Date.now() - checked > 15 * 60_000 || !Number.isFinite(expires) || expires <= Date.now()) throw new Error("publication_receipt_expired");
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== report.candidateSha256) throw new Error("catalog_report_mismatch");
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const remote = git("ls-remote", "--exit-code", "origin", "refs/heads/main").split(/\s/)[0];
  const mode = publicationPlan({ event: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, repository: process.env.GITHUB_REPOSITORY, sourceSha: process.env.GITHUB_SHA, remoteSha: remote,
    changedFiles: git("diff", "--name-only").split("\n").filter(Boolean), autoPublish: process.env.AFFINITY_SOURCE_AUTO_PUBLISH });
  git("config", "user.name", "github-actions[bot]");
  git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
  git("add", "--", CATALOG);
  git("commit", "-m", "Refresh verified Marketplace source catalog");
  if (mode === "verified_catalog_publish") {
    git("push", "origin", "HEAD:refs/heads/main");
    fs.writeFileSync("tmp/catalog-publication.json", JSON.stringify({ mode, commit: git("rev-parse", "HEAD"), checkedAt: candidate.checkedAt }) + "\n");
    console.log("Published verified data-only Git checkpoint; deployment readback is still required."); return;
  }
  const branch = `automation/catalog-${digest.slice(0, 16)}`;
  if (!git("ls-remote", "origin", `refs/heads/${branch}`)) git("push", "origin", `HEAD:refs/heads/${branch}`);
  const list = JSON.parse(execFileSync("gh", ["pr", "list", "--repo", "PWR-LABS/affinity", "--head", branch, "--json", "number"], { encoding: "utf8" }));
  if (!list.length) execFileSync("gh", ["pr", "create", "--repo", "PWR-LABS/affinity", "--base", "main", "--head", branch, "--draft", "--title", "Refresh verified Marketplace source catalog", "--body", "Official year/platform metadata and fixed synthetic availability probes passed, along with the fixture regression bundle. Only the data catalog changes. Policy text is outside automatic publication. This is a review proposal because automatic catalog publishing is disabled."], { stdio: "inherit" });
}
if (require.main === module) { try { main(); } catch { console.error("catalog_publication_failed; no force push or permission bypass attempted"); process.exitCode = 1; } }
