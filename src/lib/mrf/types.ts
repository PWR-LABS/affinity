/**
 * Types for issuer QHP machine-readable files (CMSgov/QHP-provider-formulary-APIs).
 *
 * Each issuer publishes `providers.json` and `drugs.json` (indexed by a per-issuer
 * `cms-data-index.json`). These are the "ground truth" the Marketplace API is reconciled against —
 * the second, independent source whose disagreement with the API is the network-truth signal.
 * Fields are optional because real issuer files are inconsistent and partially malformed (a Dec 2025
 * medRxiv analysis found ~59,899 import errors across 735 issuer MRF logs) — robustness here is the
 * point, not an edge case.
 */

/** One plan a provider participates in, per the issuer file. */
export interface MrfProviderPlan {
  plan_id: string;
  network_tier?: string;
}

export interface MrfProviderName {
  first?: string;
  last?: string;
}

/** A provider record from `providers.json`. */
export interface MrfProvider {
  npi: string;
  type?: string;
  name?: MrfProviderName | string;
  specialty?: string[];
  accepting?: string;
  plans?: MrfProviderPlan[];
  last_updated_on?: string;
}

/** One plan a drug is on, per the issuer file. */
export interface MrfDrugPlan {
  plan_id: string;
  drug_tier?: string;
  prior_authorization?: boolean;
}

/** A drug record from `drugs.json`. */
export interface MrfDrug {
  rxnorm_id: string;
  drug_name?: string;
  plans?: MrfDrugPlan[];
  last_updated_on?: string;
}

/** A per-issuer index file listing the provider/drug/plan MRF URLs. */
export interface MrfDataIndex {
  provider_urls?: string[];
  formulary_urls?: string[];
  plan_urls?: string[];
}
