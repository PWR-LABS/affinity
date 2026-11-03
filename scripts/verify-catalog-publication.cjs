/** Read back the responding release and source receipt, then repeat bounded source pairs. */
const fs = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");
const APP = "https://affinity.pwr-labs.ai";

function snapshotMatches(health, freshness, commit, catalog) {
  return health?.status === "ok" && health?.release?.commit === commit && health?.release?.branch === "main"
    && freshness?.marketplace?.status === "current" && freshness.marketplace.checkedAt === catalog.checkedAt
    && freshness.marketplace.defaultYear === catalog.defaultYear
    && JSON.stringify([...(freshness.marketplace.supportedYears || [])].sort()) === JSON.stringify(Object.keys(catalog.years).map(Number).sort());
}
module.exports = { snapshotMatches };

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_REPOSITORY !== "PWR-LABS/affinity") throw new Error("workflow_only");
  const publication = fs.existsSync("tmp/catalog-publication.json") ? JSON.parse(fs.readFileSync("tmp/catalog-publication.json", "utf8")) : null;
  const expectedCommit = publication?.mode === "verified_catalog_publish" ? publication.commit : process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(expectedCommit || "")) throw new Error("release_identity_missing");
  const catalog = JSON.parse(execFileSync("git", ["show", `${expectedCommit}:src/lib/marketplace/catalog-data.json`], { encoding: "utf8" }));
  async function read(path) {
    try {
      const response = await fetch(APP + path, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
      return response.ok ? await response.json() : null;
    } catch { return null; }
  }
  let observed;
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    const health = await read("/api/health");
    if (health?.release?.commit === expectedCommit) {
      const freshness = await read("/api/freshness");
      if (snapshotMatches(health, freshness, expectedCommit, catalog)) { observed = { health, freshness }; break; }
    }
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  if (!observed) throw new Error("responding_release_or_catalog_not_verified");
  const deep = await read("/api/health?deep=1");
  if (deep?.checks?.marketplaceApi !== "ok" || deep?.release?.commit !== expectedCommit) throw new Error("deployed_dependency_not_verified");
  const env = { ...process.env, AFFINITY_EVAL_APP_URL: APP, AFFINITY_EVAL_YEAR: String(catalog.defaultYear), AFFINITY_LIVE_COMMIT: expectedCommit };
  const eligibility = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval-marketplace-source-pair.ts"], { env, encoding: "utf8", timeout: 180_000 });
  const data = JSON.parse(eligibility.stdout || "null");
  if (data) fs.writeFileSync("tmp/deployed-eligibility-pair.json", JSON.stringify(data, null, 2) + "\n");
  if (eligibility.status !== 0) throw new Error("deployed_eligibility_pair_failed");
  const plans = spawnSync(process.execPath, ["--import", "tsx", "scripts/eval-plan-board-source-pair.ts", "--output", "tmp/deployed-plan-pair.json"], { env, encoding: "utf8", timeout: 180_000 });
  if (plans.status !== 0) throw new Error("deployed_plan_pair_failed");
  const handoffResponse = await fetch(`${APP}/api/eligibility`, { method: "POST", signal: AbortSignal.timeout(20_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "OR", zip: "97201", income: 45_000, householdSize: 1, age: 40, year: catalog.defaultYear }) });
  const handoff = await handoffResponse.json();
  if (!handoffResponse.ok || handoff.year !== catalog.defaultYear || (catalog.years[String(catalog.defaultYear)].models.OR === "SBM" && handoff.verdict !== "state_marketplace")) throw new Error("deployed_oregon_route_not_verified");
  const after = await read("/api/health");
  if (after?.release?.commit !== expectedCommit) throw new Error("release_changed_during_verification");
  fs.writeFileSync("tmp/deployed-catalog-receipt.json", JSON.stringify({ observedAt: new Date().toISOString(), commit: expectedCommit, checkedAt: catalog.checkedAt, year: catalog.defaultYear, releaseAndCatalogVerified: true, dependencyVerified: true, sourcePairsPassed: true, oregonRouteVerified: true, scope: "Bounded synthetic deployed checks, not independent coverage or policy-content certification" }, null, 2) + "\n");
  console.log("Responding release, catalog, deep health and bounded source pairs verified.");
}
if (require.main === module) main().catch(() => { console.error("deployed_catalog_verification_failed; do not claim the public site updated successfully"); process.exitCode = 1; });
