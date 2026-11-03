/** Exercise the whole publication gate with changed source data in a disposable, offline snapshot. */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { MarketplaceCatalog } from "@/lib/marketplace/catalog";
import { CATALOG_MAX_AGE_MS } from "@/lib/marketplace/catalog";

const root = process.cwd();
const snapshot = mkdtempSync(join(tmpdir(), "affinity-catalog-gates-"));
try {
  for (const path of ["src", "scripts", "tests", "data/fixtures", "prisma", "package.json", "package-lock.json", "tsconfig.json", "next-env.d.ts"]) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(snapshot, path), { recursive: true });
  }
  symlinkSync(join(root, "node_modules"), join(snapshot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const path = join(snapshot, "src/lib/marketplace/catalog-data.json");
  const previous: MarketplaceCatalog = JSON.parse(readFileSync(path, "utf8"));
  const priorYear = Math.max(...Object.keys(previous.years).map(Number));
  const nextYear = priorYear + 1;
  const next = structuredClone(previous.years[String(priorYear)]);
  next.models.OH = "SBM";
  next.marketplaces.OH = { state: "Ohio", name: "Synthetic Ohio exchange", url: "exchange.example.gov/ohio" };
  const years = { [priorYear]: structuredClone(previous.years[String(priorYear)]), [nextYear]: next };
  // Include link/name changes and retirement of older years, not only a new numeric default.
  for (const entry of Object.values(years)) for (const [code, exchange] of Object.entries(entry.marketplaces)) {
    exchange.name = `Synthetic ${exchange.state} exchange`;
    exchange.url = `exchange.example.gov/${code.toLowerCase()}`;
  }
  const now = Date.now();
  const candidate: MarketplaceCatalog = { schemaVersion: 1, defaultYear: nextYear, years,
    checkedAt: new Date(now).toISOString(), expiresAt: new Date(now + CATALOG_MAX_AGE_MS).toISOString(),
    evidence: { source: previous.evidence.source, advertisedYears: [priorYear, nextYear], probedYears: [priorYear, nextYear], probeProfiles: 10 } };
  writeFileSync(path, JSON.stringify(candidate, null, 2) + "\n");
  const run = (script: string) => spawnSync("npm", ["run", "-s", script], { cwd: snapshot, encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  const valid = run("eval:production-readiness");
  if (valid.status !== 0) {
    console.error((valid.stdout + valid.stderr).slice(-8_000));
    throw new Error("valid_catalog_transition_rejected");
  }
  delete candidate.years[String(nextYear)].models.OH;
  writeFileSync(path, JSON.stringify(candidate, null, 2) + "\n");
  const invalid = run("eval:marketplace-catalog");
  if (invalid.status === 0 || !invalid.stderr.includes("marketplace_catalog_validation_failed")) throw new Error("invalid_live_catalog_not_rejected");
  console.log(JSON.stringify({ status: "passed", syntheticDefaultYear: nextYear, changedRoutingAndLinksAccepted: true, retiredYearsAccepted: true, incompleteActualCatalogRejected: true }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "catalog_transition_check_failed");
  process.exitCode = 1;
} finally {
  rmSync(snapshot, { recursive: true, force: true });
}
