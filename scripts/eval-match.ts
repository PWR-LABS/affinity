/**
 * eval:match — the M1 gate.
 *
 * Runs the matching engine over a household (doctors + meds) against multiple plans and checks the
 * per-plan coverage summary, the confirm list, and the ranking order against a deterministic fixture
 * answer key. Asserts the doctrine holds end to end: every subject resolves to an honest status, and
 * only clean high-confidence agreements escape the "confirm with the provider" list.
 *
 * LIVE mode (MARKETPLACE_API_KEY + AFFINITY_EVAL_* set) runs the same engine against real plans for the
 * operator's rating area and asserts a well-formed ranked result. Exit code is the gate: 0 pass, 1 fail.
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

const FIXTURE_PATH = path.join(process.cwd(), "data", "fixtures", "match-sample.json");

function printPlan(m: PlanMatch): void {
  const s = m.summary;
  console.log(`\n  ${m.planLabel ?? m.planId}  [${m.planId}]`);
  console.log(
    `    doctors: ${s.doctorsCovered}/${s.doctorsTotal} covered` +
      `${s.doctorsDisputed ? `, ${s.doctorsDisputed} disputed` : ""}` +
      `${s.doctorsNotCovered ? `, ${s.doctorsNotCovered} not covered` : ""}` +
      `${s.doctorsUnknown ? `, ${s.doctorsUnknown} unknown` : ""}`,
  );
  console.log(
    `    meds:    ${s.drugsOnFormulary}/${s.drugsTotal} on formulary` +
      `${s.drugsDisputed ? `, ${s.drugsDisputed} disputed` : ""}` +
      `${s.drugsNotCovered ? `, ${s.drugsNotCovered} not covered` : ""}` +
      `${s.drugsUnknown ? `, ${s.drugsUnknown} unknown` : ""}`,
  );
  console.log(
    `    matchScore ${s.matchScore}  ·  networkConfidence ${s.networkConfidence}  ·  confirm: ${
      s.confirmList.length ? s.confirmList.map((c) => c.subjectKey).join(", ") : "none"
    }`,
  );
}

async function runFixture(): Promise<boolean> {
  const fx = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  const profile = fx.profile as MatchProfileInput;
  const dataset = datasetFromRecords(
    fx.mrfProviders as MrfProvider[],
    fx.mrfDrugs as MrfDrug[],
    fx.fetchedAt as string,
  );

  const inputs: PlanCoverageInputs[] = (fx.plans as Array<Record<string, unknown>>).map((p) => ({
    planId: p.planId as string,
    planLabel: p.planLabel as string,
    apiProviders: new Map<string, MarketplaceProviderCoverage>(
      (p.apiProviders as MarketplaceProviderCoverage[]).map((c) => [c.npi, c]),
    ),
    apiDrugs: new Map<string, MarketplaceDrugCoverage>(
      (p.apiDrugs as MarketplaceDrugCoverage[]).map((c) => [c.rxcui, c]),
    ),
  }));

  const ranked = matchProfile(profile, inputs, dataset, fx.fetchedAt as string);
  console.log("\n  mode: FIXTURE (no MARKETPLACE_API_KEY — wiring it flips to LIVE)");
  for (const m of ranked) printPlan(m);

  const failures: string[] = [];

  // 1) Ranking order matches the answer key.
  const gotRanking = ranked.map((m) => m.planId);
  if (JSON.stringify(gotRanking) !== JSON.stringify(fx.expectedRanking)) {
    failures.push(`ranking: got [${gotRanking}], expected [${fx.expectedRanking}]`);
  }

  // 2) Per-plan summary counts + confirm list match.
  const byId = new Map(ranked.map((m) => [m.planId, m]));
  for (const p of fx.plans as Array<Record<string, unknown>>) {
    const m = byId.get(p.planId as string);
    const exp = p.expected as Record<string, unknown>;
    if (!m) {
      failures.push(`plan ${p.planId}: missing from results`);
      continue;
    }
    const s = m.summary;
    const checks: Array<[string, number, number]> = [
      ["doctorsCovered", s.doctorsCovered, exp.doctorsCovered as number],
      ["doctorsDisputed", s.doctorsDisputed, exp.doctorsDisputed as number],
      ["doctorsNotCovered", s.doctorsNotCovered, exp.doctorsNotCovered as number],
      ["doctorsUnknown", s.doctorsUnknown, exp.doctorsUnknown as number],
      ["drugsOnFormulary", s.drugsOnFormulary, exp.drugsOnFormulary as number],
      ["drugsDisputed", s.drugsDisputed, exp.drugsDisputed as number],
      ["drugsNotCovered", s.drugsNotCovered, exp.drugsNotCovered as number],
      ["drugsUnknown", s.drugsUnknown, exp.drugsUnknown as number],
    ];
    for (const [name, got, want] of checks) {
      if (got !== want) failures.push(`plan ${p.planId} ${name}: got ${got}, expected ${want}`);
    }
    const gotConfirm = s.confirmList.map((c) => c.subjectKey).sort();
    const wantConfirm = [...(exp.confirmKeys as string[])].sort();
    if (JSON.stringify(gotConfirm) !== JSON.stringify(wantConfirm)) {
      failures.push(`plan ${p.planId} confirmKeys: got [${gotConfirm}], expected [${wantConfirm}]`);
    }
  }

  if (failures.length) {
    console.log(`\n  ✗ FAIL — matching diverged from the fixture answer key:`);
    for (const f of failures) console.log(`     - ${f}`);
    return false;
  }
  console.log(`\n  ✓ per-plan coverage, confirm lists, and ranking match the fixture answer key.`);
  return true;
}

function envProfile() {
  const zip = process.env.AFFINITY_EVAL_ZIP;
  const providersUrl = process.env.AFFINITY_EVAL_MRF_PROVIDERS_URL;
  const drugsUrl = process.env.AFFINITY_EVAL_MRF_DRUGS_URL;
  const npis = (process.env.AFFINITY_EVAL_NPIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const rxcuis = (process.env.AFFINITY_EVAL_RXCUIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!zip || !providersUrl || !drugsUrl || (npis.length === 0 && rxcuis.length === 0)) return null;
  return {
    zip,
    providersUrl,
    drugsUrl,
    npis,
    rxcuis,
    income: Number(process.env.AFFINITY_EVAL_INCOME ?? "30000"),
    ages: (process.env.AFFINITY_EVAL_AGES ?? "30").split(",").map((s) => Number(s.trim())).filter((n) => n > 0),
    year: Number(process.env.AFFINITY_EVAL_YEAR ?? "2026"),
  };
}

async function runLive(client: MarketplaceClient): Promise<boolean> {
  const p = envProfile();
  if (!p) {
    console.log(
      "\n  MARKETPLACE_API_KEY is set but AFFINITY_EVAL_* is not — falling back to the fixture gate.",
    );
    return runFixture();
  }
  const { loadMrfDataset } = await import("@/lib/mrf/client");
  const dataset = await loadMrfDataset({ providersUrl: p.providersUrl, drugsUrl: p.drugsUrl });
  const ranked = await matchProfileLive({
    client,
    profile: {
      doctors: p.npis.map((npi) => ({ npi })),
      medications: p.rxcuis.map((rxcui) => ({ rxcui })),
    },
    dataset,
    options: { zip: p.zip, income: p.income, ages: p.ages, year: p.year },
  });
  console.log(`\n  mode: LIVE (${ranked.length} plans for ZIP ${p.zip})`);
  for (const m of ranked.slice(0, 10)) printPlan(m);
  const ok =
    ranked.length > 0 &&
    ranked.every((m) => m.summary.doctorsTotal === p.npis.length && m.summary.drugsTotal === p.rxcuis.length);
  return ok;
}

async function main(): Promise<void> {
  console.log("eval:match — [affinity.] network + formulary matching");
  const client = new MarketplaceClient();
  const ok = client.isLive ? await runLive(client) : await runFixture();
  console.log(ok ? "\nPASS\n" : "\nFAIL\n");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("eval:match crashed:", err);
  process.exit(1);
});
