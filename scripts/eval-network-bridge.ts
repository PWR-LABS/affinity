/**
 * eval:network-bridge — the CCF-vs-UH "can one plan keep both systems?" gate.
 *
 * Runs the M1 matching engine, then groups each plan's providers by health system and asks the
 * make-or-break question for a split household: does any plan keep EVERY required system in-network,
 * and for the plans that don't, exactly which system (and which critical provider) falls out? Asserts
 * the bridge classification, critical-gap detection, and ranking against a deterministic fixture.
 *
 * LIVE mode (MARKETPLACE_API_KEY + AFFINITY_EVAL_* incl. AFFINITY_EVAL_PROVIDER_SYSTEMS) runs the same
 * analysis over real plans for the operator's rating area. Exit code is the gate: 0 pass, 1 fail.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { MarketplaceClient } from "@/lib/marketplace/client";
import type {
  MarketplaceDrugCoverage,
  MarketplaceProviderCoverage,
} from "@/lib/marketplace/types";
import { matchProfile, type PlanCoverageInputs } from "@/lib/matching/engine";
import { matchProfileLive } from "@/lib/matching/live";
import type { MatchProfileInput, PlanMatch } from "@/lib/matching/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import type { MrfDrug, MrfProvider } from "@/lib/mrf/types";
import { analyzeBridges } from "@/lib/network/bridge";
import type { BridgeReport, ProviderSystemTag } from "@/lib/network/types";

const FIXTURE_PATH = path.join(process.cwd(), "data", "fixtures", "network-bridge-sample.json");

function printReport(report: BridgeReport): void {
  console.log(`\n  required systems: ${report.requiredSystems.join(", ")}`);
  console.log(`  any plan keeps ALL systems in-network? ${report.anyBridges ? "YES" : "NO"}`);
  report.plans.forEach((p, i) => {
    console.log(`\n  ${i + 1}. ${p.planLabel ?? p.planId}  [${p.planId}]  → ${p.bridgeStatus}  (score ${p.score})`);
    console.log(
      `     systems: ${p.systems
        .map((s) => `${s.system}=${s.status} (${s.providersCovered}/${s.providersTotal}, ${Math.round(s.confidence * 100)}%)`)
        .join("  ·  ")}`,
    );
    console.log(`     ${p.headline}`);
  });
}

function buildInputs(fxPlans: Array<Record<string, unknown>>): PlanCoverageInputs[] {
  return fxPlans.map((p) => ({
    planId: p.planId as string,
    planLabel: p.planLabel as string,
    apiProviders: new Map<string, MarketplaceProviderCoverage>(
      ((p.apiProviders as MarketplaceProviderCoverage[]) ?? []).map((c) => [c.npi, c]),
    ),
    apiDrugs: new Map<string, MarketplaceDrugCoverage>(
      ((p.apiDrugs as MarketplaceDrugCoverage[]) ?? []).map((c) => [c.rxcui, c]),
    ),
  }));
}

function assertSet(failures: string[], name: string, got: string[], want: string[]): void {
  const g = [...got].sort();
  const w = [...want].sort();
  if (JSON.stringify(g) !== JSON.stringify(w)) failures.push(`${name}: got [${g}], expected [${w}]`);
}

async function runFixture(): Promise<boolean> {
  const fx = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  const profile = fx.profile as MatchProfileInput;
  const dataset = datasetFromRecords(
    fx.mrfProviders as MrfProvider[],
    (fx.mrfDrugs as MrfDrug[]) ?? [],
    fx.fetchedAt as string,
  );
  const inputs = buildInputs(fx.plans as Array<Record<string, unknown>>);
  const matches = matchProfile(profile, inputs, dataset, fx.fetchedAt as string);
  const report = analyzeBridges({
    matches,
    tags: fx.systemTags as ProviderSystemTag[],
    asOf: fx.fetchedAt as string,
    isLive: false,
  });

  console.log("\n  mode: FIXTURE (no MARKETPLACE_API_KEY — wiring it flips to LIVE)");
  printReport(report);

  const failures: string[] = [];
  if (report.anyBridges !== fx.expectedAnyBridges) {
    failures.push(`anyBridges: got ${report.anyBridges}, expected ${fx.expectedAnyBridges}`);
  }
  const gotRanking = report.plans.map((p) => p.planId);
  if (JSON.stringify(gotRanking) !== JSON.stringify(fx.expectedRanking)) {
    failures.push(`ranking: got [${gotRanking}], expected [${fx.expectedRanking}]`);
  }
  const byId = new Map(report.plans.map((p) => [p.planId, p]));
  for (const p of fx.plans as Array<Record<string, unknown>>) {
    const got = byId.get(p.planId as string);
    const exp = p.expected as Record<string, unknown>;
    if (!got) {
      failures.push(`plan ${p.planId}: missing from results`);
      continue;
    }
    if (got.bridgeStatus !== exp.bridgeStatus) {
      failures.push(`plan ${p.planId} bridgeStatus: got ${got.bridgeStatus}, expected ${exp.bridgeStatus}`);
    }
    assertSet(failures, `plan ${p.planId} systemsKept`, got.systemsKept, exp.systemsKept as string[]);
    assertSet(failures, `plan ${p.planId} systemsLost`, got.systemsLost, exp.systemsLost as string[]);
    assertSet(
      failures,
      `plan ${p.planId} criticalGaps`,
      got.criticalGaps.map((g) => g.subjectKey),
      exp.criticalGapKeys as string[],
    );
  }

  if (failures.length) {
    console.log("\n  ✗ FAIL — bridge analysis diverged from the fixture answer key:");
    for (const f of failures) console.log(`     - ${f}`);
    return false;
  }
  console.log("\n  ✓ bridge status, critical-gap detection, and ranking match the fixture answer key.");
  return true;
}

function parseSystemTags(): ProviderSystemTag[] {
  const critical = new Set(
    (process.env.AFFINITY_EVAL_CRITICAL_NPIS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  return (process.env.AFFINITY_EVAL_PROVIDER_SYSTEMS ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [npi, system] = pair.split(":").map((s) => s.trim());
      return { npi, system, critical: critical.has(npi) } satisfies ProviderSystemTag;
    })
    .filter((t) => t.npi && t.system);
}

function envProfile() {
  const zip = process.env.AFFINITY_EVAL_ZIP;
  const providersUrl = process.env.AFFINITY_EVAL_MRF_PROVIDERS_URL;
  const drugsUrl = process.env.AFFINITY_EVAL_MRF_DRUGS_URL;
  const npis = (process.env.AFFINITY_EVAL_NPIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const tags = parseSystemTags();
  if (!zip || !providersUrl || !drugsUrl || npis.length === 0 || tags.length === 0) return null;
  return {
    zip,
    providersUrl,
    drugsUrl,
    npis,
    rxcuis: (process.env.AFFINITY_EVAL_RXCUIS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    income: Number(process.env.AFFINITY_EVAL_INCOME ?? "30000"),
    ages: (process.env.AFFINITY_EVAL_AGES ?? "30").split(",").map((s) => Number(s.trim())).filter((n) => n > 0),
    year: Number(process.env.AFFINITY_EVAL_YEAR ?? "2026"),
    tags,
  };
}

async function runLive(client: MarketplaceClient): Promise<boolean> {
  const p = envProfile();
  if (!p) {
    console.log(
      "\n  MARKETPLACE_API_KEY is set but AFFINITY_EVAL_* (incl. AFFINITY_EVAL_PROVIDER_SYSTEMS) is incomplete — falling back to the fixture gate.",
    );
    return runFixture();
  }
  const { loadMrfDataset } = await import("@/lib/mrf/client");
  const dataset = await loadMrfDataset({ providersUrl: p.providersUrl, drugsUrl: p.drugsUrl });
  const matches: PlanMatch[] = await matchProfileLive({
    client,
    profile: {
      doctors: p.npis.map((npi) => ({ npi })),
      medications: p.rxcuis.map((rxcui) => ({ rxcui })),
    },
    dataset,
    options: { zip: p.zip, income: p.income, ages: p.ages, year: p.year },
  });
  const report = analyzeBridges({ matches, tags: p.tags, asOf: new Date().toISOString(), isLive: true });
  console.log(`\n  mode: LIVE (${matches.length} plans for ZIP ${p.zip})`);
  printReport(report);
  console.log(
    report.anyBridges
      ? "\n  → At least one plan keeps every system in-network — confirm with the offices before trusting it."
      : "\n  → No plan keeps every system; the split is real. Each plan's trade-off is shown above.",
  );
  return report.requiredSystems.length > 0 && report.plans.length > 0;
}

async function main(): Promise<void> {
  console.log("eval:network-bridge — [affinity.] can one plan keep every health system?");
  const client = new MarketplaceClient();
  const ok = client.isLive ? await runLive(client) : await runFixture();
  console.log(ok ? "\nPASS\n" : "\nFAIL\n");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("eval:network-bridge crashed:", err);
  process.exit(1);
});
