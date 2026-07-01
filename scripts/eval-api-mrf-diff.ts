/**
 * eval:api-mrf-diff — the M0 moat gate (feasibility check AND first proof of the network-truth thesis).
 *
 * Diffs the Marketplace API's in-network/formulary answers against an issuer's own machine-readable
 * file for the same (provider|drug, plan) pairs, and reports agreement / conflict / one-sided /
 * unknown counts. Conflicts are the signal: "API says in-network, the issuer's file says out".
 *
 * Two modes, same reconciliation core:
 *   - LIVE  — when MARKETPLACE_API_KEY + AFFINITY_EVAL_* (profile + issuer MRF URLs) are set, it pulls
 *             real data for the operator's rating area and diffs it.
 *   - FIXTURE (default) — runs the bundled deterministic sample and ASSERTS the verdict counts, so the
 *             gate is green headlessly before the API key lands. Wiring the key flips it to live.
 *
 * Exit code is the gate: 0 = pass, 1 = fail.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  MarketplaceClient,
  drugCoverageToAnswer,
  providerCoverageToAnswer,
} from "@/lib/marketplace/client";
import type {
  MarketplaceDrugCoverage,
  MarketplaceProviderCoverage,
} from "@/lib/marketplace/types";
import { datasetFromRecords, loadMrfDataset } from "@/lib/mrf/client";
import type { MrfDataset } from "@/lib/mrf/dataset";
import type { MrfDrug, MrfProvider } from "@/lib/mrf/types";
import { renderCoverageAnswer } from "@/lib/provenance";
import { reconcileClaim, summarize, type ReconciledClaim } from "@/lib/reconcile";

const FIXTURE_PATH = path.join(process.cwd(), "data", "fixtures", "api-mrf-sample.json");

/** Reconcile a probe list against API answer-maps + an MRF dataset for one plan. */
function reconcileProbe(args: {
  planId: string;
  fetchedAt: string;
  apiProviders: Map<string, MarketplaceProviderCoverage>;
  apiDrugs: Map<string, MarketplaceDrugCoverage>;
  dataset: MrfDataset;
  probe: { providers: string[]; drugs: string[] };
  apiSourceUrl?: string;
}): ReconciledClaim[] {
  const out: ReconciledClaim[] = [];

  for (const npi of args.probe.providers) {
    const raw = args.apiProviders.get(npi) ?? { npi }; // absent → unknown (silence is not denial)
    const api = providerCoverageToAnswer(raw, args.fetchedAt, args.apiSourceUrl);
    const mrf = args.dataset.providerAnswer(npi, args.planId);
    out.push(reconcileClaim({ kind: "PROVIDER", subjectKey: npi, planId: args.planId, api, mrf }));
  }

  for (const rxcui of args.probe.drugs) {
    const raw = args.apiDrugs.get(rxcui) ?? { rxcui };
    const api = drugCoverageToAnswer(raw, args.fetchedAt, args.apiSourceUrl);
    const mrf = args.dataset.drugAnswer(rxcui, args.planId);
    out.push(reconcileClaim({ kind: "DRUG", subjectKey: rxcui, planId: args.planId, api, mrf }));
  }

  return out;
}

function printSummary(mode: string, planId: string, claims: ReconciledClaim[]): void {
  const s = summarize(claims);
  console.log(`\n  mode: ${mode}   plan: ${planId}`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  pairs reconciled : ${s.total}`);
  console.log(`  AGREE            : ${s.agree}`);
  console.log(`  CONFLICT         : ${s.conflict}   ⚠️  the network-truth signal`);
  console.log(`  API_ONLY         : ${s.apiOnly}   (API answered, issuer file silent)`);
  console.log(`  MRF_ONLY         : ${s.mrfOnly}   (issuer file answered, API silent)`);
  console.log(`  BOTH_UNKNOWN     : ${s.bothUnknown}`);
  console.log(
    `  agreement (of comparable pairs): ${
      s.agreementRateAmongComparable === null ? "n/a" : `${Math.round(s.agreementRateAmongComparable * 100)}%`
    }`,
  );

  const conflicts = claims.filter((c) => c.verdict === "CONFLICT");
  if (conflicts.length) {
    console.log(`\n  Conflicts to confirm with the provider's office (the M3 checklist seed):`);
    for (const c of conflicts) {
      console.log(`   • [${c.kind}] ${c.subjectKey}`);
      console.log(`       API: ${renderCoverageAnswer(c.api)}`);
      console.log(`       MRF: ${renderCoverageAnswer(c.mrf)}`);
    }
  }
}

async function runFixture(): Promise<boolean> {
  const fixture = JSON.parse(await fs.readFile(FIXTURE_PATH, "utf8"));
  const apiProviders = new Map<string, MarketplaceProviderCoverage>(
    (fixture.apiProviders as MarketplaceProviderCoverage[]).map((p) => [p.npi, p]),
  );
  const apiDrugs = new Map<string, MarketplaceDrugCoverage>(
    (fixture.apiDrugs as MarketplaceDrugCoverage[]).map((d) => [d.rxcui, d]),
  );
  const dataset = datasetFromRecords(
    fixture.mrfProviders as MrfProvider[],
    fixture.mrfDrugs as MrfDrug[],
    fixture.fetchedAt as string,
  );

  const claims = reconcileProbe({
    planId: fixture.planId,
    fetchedAt: fixture.fetchedAt,
    apiProviders,
    apiDrugs,
    dataset,
    probe: fixture.probe,
  });
  printSummary("FIXTURE (no MARKETPLACE_API_KEY — wiring it flips to LIVE)", fixture.planId, claims);

  // The gate: the fixture has a known-correct answer key; assert the diff reproduces it exactly.
  const got = summarize(claims);
  const exp = fixture.expected;
  const mismatches: string[] = [];
  for (const k of ["total", "agree", "conflict", "apiOnly", "mrfOnly", "bothUnknown"] as const) {
    if (got[k] !== exp[k]) mismatches.push(`${k}: got ${got[k]}, expected ${exp[k]}`);
  }
  if (got.agreementRateAmongComparable !== exp.agreementRateAmongComparable) {
    mismatches.push(
      `agreementRateAmongComparable: got ${got.agreementRateAmongComparable}, expected ${exp.agreementRateAmongComparable}`,
    );
  }
  if (mismatches.length) {
    console.log(`\n  ✗ FAIL — reconciliation counts diverged from the fixture answer key:`);
    for (const m of mismatches) console.log(`     - ${m}`);
    return false;
  }
  console.log(`\n  ✓ reconciliation counts match the fixture answer key.`);
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
    planId: process.env.AFFINITY_EVAL_PLAN_ID,
  };
}

async function runLive(client: MarketplaceClient): Promise<boolean> {
  const p = envProfile();
  if (!p) {
    console.log(
      "\n  MARKETPLACE_API_KEY is set but the eval profile is not. Set AFFINITY_EVAL_ZIP,\n" +
        "  AFFINITY_EVAL_NPIS / AFFINITY_EVAL_RXCUIS, and AFFINITY_EVAL_MRF_PROVIDERS_URL /\n" +
        "  AFFINITY_EVAL_MRF_DRUGS_URL to run the live diff. Falling back to the fixture gate.",
    );
    return runFixture();
  }

  const fetchedAt = new Date().toISOString();
  const counties = await client.countiesByZip(p.zip);
  if (counties.length === 0) throw new Error(`No county found for ZIP ${p.zip}`);
  const place = { zipcode: p.zip, countyfips: counties[0].fips, state: counties[0].state };

  const search = await client.searchPlans({
    household: { income: p.income, people: p.ages.map((age) => ({ age })) },
    market: "Individual",
    place,
    year: p.year,
    providers: p.npis.length ? { npis: p.npis } : undefined,
    drugs: p.rxcuis.length ? { rxcuis: p.rxcuis } : undefined,
  });

  const plan = p.planId ? search.plans.find((x) => x.id === p.planId) : search.plans[0];
  if (!plan) throw new Error("No plan returned to reconcile against.");

  const apiProviders = new Map<string, MarketplaceProviderCoverage>(
    (plan.provider_coverage ?? []).map((c) => [c.npi, c]),
  );
  const apiDrugs = new Map<string, MarketplaceDrugCoverage>(
    (plan.drug_coverage ?? []).map((c) => [c.rxcui, c]),
  );

  const dataset = await loadMrfDataset({
    providersUrl: p.providersUrl,
    drugsUrl: p.drugsUrl,
    fetchedAt,
  });

  const claims = reconcileProbe({
    planId: plan.id,
    fetchedAt,
    apiProviders,
    apiDrugs,
    dataset,
    probe: { providers: p.npis, drugs: p.rxcuis },
    apiSourceUrl: `${process.env.MARKETPLACE_API_BASE ?? "marketplace.api.healthcare.gov"}/plans/search`,
  });
  printSummary(`LIVE (issuer MRF: ${dataset.providerCount} providers, ${dataset.drugCount} drugs)`, plan.id, claims);
  // Live gate: the diff ran end to end and produced a well-formed summary over the probe set.
  return claims.length === p.npis.length + p.rxcuis.length;
}

async function main(): Promise<void> {
  console.log("eval:api-mrf-diff — Marketplace API ↔ issuer MRF reconciliation");
  const client = new MarketplaceClient();
  const ok = client.isLive ? await runLive(client) : await runFixture();
  console.log(ok ? "\nPASS\n" : "\nFAIL\n");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("eval:api-mrf-diff crashed:", err);
  process.exit(1);
});
