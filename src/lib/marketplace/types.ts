/**
 * Types for the HealthCare.gov Marketplace API v1 (developer.cms.gov/marketplace-api).
 *
 * These model the slices of the API [affinity.] uses in M0–M3: rating-area lookup, plan search with
 * per-plan provider/drug coverage flags, and the eligibility/subsidy estimate. They are intentionally
 * permissive (optional fields) because the live API is sparsely populated and we never want a missing
 * field to read as a definitive "not covered" — that distinction is the whole product.
 */

/** A household member for rating + eligibility. No DOB — only what the API needs. */
export interface MarketplaceHouseholdMember {
  age: number;
  /** "Adult" applicants and dependents both supported; defaults to applicant. */
  aptc_eligible?: boolean;
  gender?: "Female" | "Male";
  uses_tobacco?: boolean;
  is_pregnant?: boolean;
  is_parent?: boolean;
  relationship?: string;
}

export interface MarketplaceHousehold {
  income: number;
  people: MarketplaceHouseholdMember[];
  has_married_couple?: boolean;
}

export interface MarketplacePlace {
  zipcode: string;
  countyfips: string;
  state: string;
}

/** A provider the caller wants coverage flags for, keyed by NPI. */
export interface MarketplaceProviderQuery {
  npis: string[];
}

/** A drug the caller wants coverage flags for, keyed by RxCUI. */
export interface MarketplaceDrugQuery {
  rxcuis: string[];
}

export interface MarketplacePlanSearchRequest {
  household: MarketplaceHousehold;
  market: "Individual";
  place: MarketplacePlace;
  year: number;
  /** Optional NPIs — when present each returned plan carries `provider_coverage` entries. */
  providers?: MarketplaceProviderQuery;
  /** Optional RxCUIs — when present each returned plan carries `drug_coverage` entries. */
  drugs?: MarketplaceDrugQuery;
  offset?: number;
  limit?: number;
}

/** Per-plan coverage flag the API returns for a queried provider. */
export interface MarketplaceProviderCoverage {
  npi: string;
  /** Present on `/providers/covered` results — the plan this coverage flag is for. */
  plan_id?: string;
  name?: string;
  /** "Covered" | "NotCovered" | "PartiallyCovered" | (absent = not returned/unknown). */
  coverage?: string;
  network_tier?: string;
  /** Provider's accepting-new-patients status, e.g. "accepting" | "unknown". */
  accepting?: string;
}

/** Per-plan coverage flag the API returns for a queried drug. */
export interface MarketplaceDrugCoverage {
  rxcui: string;
  /** Present on `/drugs/covered` results — the plan this coverage flag is for. */
  plan_id?: string;
  name?: string;
  /** "Covered" | "NotCovered" (absent = unknown). */
  coverage?: string;
  drug_tier?: string;
  prior_authorization?: boolean;
}

/** A cost-sharing entry (deductible or out-of-pocket max) — the live API returns several CSR/tier variants. */
export interface MarketplaceCostShare {
  amount?: number;
  type?: string;
  csr?: string;
  network_tier?: string;
  family_cost?: string;
}

export interface MarketplacePlan {
  id: string;
  name: string;
  issuer?: { name?: string };
  metal_level?: string;
  type?: string;
  /** Gross monthly premium (pre-subsidy). */
  premium?: number;
  /** Monthly premium after the household's premium tax credit is applied. */
  premium_w_credit?: number;
  deductibles?: MarketplaceCostShare[];
  moops?: MarketplaceCostShare[];
  provider_coverage?: MarketplaceProviderCoverage[];
  drug_coverage?: MarketplaceDrugCoverage[];
  /** Issuer-hosted plan documents the API returns per plan. */
  benefits_url?: string;
  /** Summary of Benefits & Coverage (SBC) — the standardized official plan summary. */
  brochure_url?: string;
  formulary_url?: string;
  network_url?: string;
}

export interface MarketplacePlanSearchResponse {
  plans: MarketplacePlan[];
  total: number;
  rate_area?: string;
}

export interface MarketplaceCounty {
  fips: string;
  name: string;
  state: string;
  zipcode: string;
}

export interface MarketplaceCountiesResponse {
  counties: MarketplaceCounty[];
}

export interface MarketplaceEligibilityEstimate {
  /** Advance premium tax credit (monthly), pre-plan-selection. */
  aptc?: number;
  /** Cost-sharing reduction variant the household qualifies for (e.g. "73", "87", "94"). */
  csr?: string;
  is_medicaid_chip?: boolean;
  hardship_exemption?: boolean;
}

export interface MarketplaceEligibilityResponse {
  estimates: MarketplaceEligibilityEstimate[];
}

/** A drug suggestion from `/drugs/autocomplete` — a specific product (strength + form). */
export interface MarketplaceDrugSuggestion {
  rxcui: string;
  name?: string;
  strength?: string;
  route?: string;
  full_name?: string;
}

/** A provider suggestion from `/providers/autocomplete` (name search near a ZIP). */
export interface MarketplaceProviderSuggestion {
  npi: string;
  name?: string;
  specialties?: string[];
  taxonomy?: string;
  accepting?: string;
}
