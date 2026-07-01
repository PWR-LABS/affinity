/**
 * Live wiring for M1 matching — Marketplace API + one issuer MRF → ranked PlanMatch[].
 *
 * Resolves the rating area from a ZIP, searches plans carrying the household's NPIs + RxCUIs (so each
 * plan comes back with provider/drug coverage flags), then reconciles every plan against the issuer's
 * MRF dataset and ranks. Plans outside the supplied issuer's file reconcile as API_ONLY — honest, and
 * multi-issuer MRF fan-out is a later refinement. Inert until MARKETPLACE_API_KEY is set (the client
 * throws a catchable MarketplaceConfigError), which is the whole "ready when the key lands" point.
 */
import { MarketplaceClient } from "@/lib/marketplace/client";
import type {
  MarketplaceDrugCoverage,
  MarketplaceProviderCoverage,
} from "@/lib/marketplace/types";
import type { MrfDataset } from "@/lib/mrf/dataset";

import { matchProfile, type PlanCoverageInputs } from "./engine";
import type { MatchProfileInput, PlanMatch } from "./types";

export interface LiveMatchOptions {
  zip: string;
  income: number;
  ages: number[];
  year: number;
}

/** Build the per-plan API coverage maps from a search result + reconcile against the MRF dataset. */
export async function matchProfileLive(args: {
  client: MarketplaceClient;
  profile: MatchProfileInput;
  dataset: MrfDataset;
  options: LiveMatchOptions;
  fetchedAt?: string;
}): Promise<PlanMatch[]> {
  const { client, profile, dataset, options } = args;
  const fetchedAt = args.fetchedAt ?? new Date().toISOString();

  const counties = await client.countiesByZip(options.zip);
  if (counties.length === 0) throw new Error(`No county found for ZIP ${options.zip}`);
  const place = { zipcode: options.zip, countyfips: counties[0].fips, state: counties[0].state };

  const search = await client.searchPlans({
    household: { income: options.income, people: options.ages.map((age) => ({ age })) },
    market: "Individual",
    place,
    year: options.year,
    providers: profile.doctors.length ? { npis: profile.doctors.map((d) => d.npi) } : undefined,
    drugs: profile.medications.length ? { rxcuis: profile.medications.map((m) => m.rxcui) } : undefined,
  });

  const inputs: PlanCoverageInputs[] = search.plans.map((plan) => ({
    planId: plan.id,
    planLabel: plan.name,
    apiProviders: new Map<string, MarketplaceProviderCoverage>(
      (plan.provider_coverage ?? []).map((c) => [c.npi, c]),
    ),
    apiDrugs: new Map<string, MarketplaceDrugCoverage>(
      (plan.drug_coverage ?? []).map((c) => [c.rxcui, c]),
    ),
  }));

  return matchProfile(profile, inputs, dataset, fetchedAt);
}
