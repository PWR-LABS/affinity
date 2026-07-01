/**
 * Load the demo decision board from the bundled fixture (no DB, no API key).
 *
 * This is what the M4 web shell renders until the operator wires `MARKETPLACE_API_KEY` +
 * `AFFINITY_EVAL_*`; at that point a live assembler (Marketplace search + issuer MRF) produces the same
 * {@link DecisionBoard} shape and the UI is unchanged. Server-side only (reads from disk).
 */
import type { MarketplaceDrugCoverage, MarketplaceProviderCoverage } from "@/lib/marketplace/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import type { MrfDrug, MrfProvider } from "@/lib/mrf/types";

// Imported (not fs-read) so it is bundled into the Next standalone output and works at runtime.
import fixtureJson from "../../../data/fixtures/decision-sample.json";

import { assembleDecision, type DecisionPlanInput } from "./assemble";
import type { DecisionBoard } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadDemoDecisionBoard(): Promise<DecisionBoard> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fx = fixtureJson as any;

  const dataset = datasetFromRecords(fx.mrfProviders as MrfProvider[], fx.mrfDrugs as MrfDrug[], fx.fetchedAt);

  const plans: DecisionPlanInput[] = (fx.plans as Array<Record<string, unknown>>).map((p) => ({
    planId: p.planId as string,
    planLabel: p.planLabel as string,
    metalLevel: p.metalLevel as DecisionPlanInput["metalLevel"],
    premiumUsdMonthly: p.premiumUsdMonthly as number,
    deductibleUsd: p.deductibleUsd as number,
    oopMaxUsd: p.oopMaxUsd as number,
    coinsuranceRate: p.coinsuranceRate as number,
    apiProviders: new Map((p.apiProviders as MarketplaceProviderCoverage[]).map((c) => [c.npi, c])),
    apiDrugs: new Map((p.apiDrugs as MarketplaceDrugCoverage[]).map((c) => [c.rxcui, c])),
  }));

  return assembleDecision({
    profile: { doctors: fx.profile.doctors, medications: fx.profile.medications },
    profileMeta: {
      zip: fx.profile.zip,
      householdIncomeUsd: fx.profile.householdIncomeUsd,
      householdSize: fx.profile.householdSize,
    },
    benchmarkMonthlyPremiumUsd: fx.benchmarkMonthlyPremiumUsd,
    utilization: fx.utilization,
    drug: fx.drug,
    plans,
    dataset,
    fetchedAt: fx.fetchedAt,
    asOf: fx.asOf,
    isLive: Boolean(fx.isLive),
  });
}
