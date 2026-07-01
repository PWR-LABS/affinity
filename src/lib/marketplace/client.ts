/**
 * HealthCare.gov Marketplace API v1 client.
 *
 * Wraps the endpoints M0 needs — rating-area lookup, plan search (with per-plan provider/drug
 * coverage), and the eligibility/subsidy estimate — and tags every coverage flag with provenance via
 * {@link makeCoverageAnswer}. The client is usable WITHOUT a key for typecheck/wiring: methods that
 * hit the network throw a clear, catchable {@link MarketplaceConfigError} when `MARKETPLACE_API_KEY`
 * is unset, so callers (and the eval harness) can branch to fixtures instead of failing hard.
 *
 * Request a key at developer.cms.gov/marketplace-api (free, rotates every 60 days).
 */
import { cached } from "@/lib/cache";
import { makeCoverageAnswer, type CoverageAnswer } from "@/lib/provenance";

import type {
  MarketplaceCountiesResponse,
  MarketplaceCounty,
  MarketplaceDrugCoverage,
  MarketplaceDrugSuggestion,
  MarketplaceEligibilityResponse,
  MarketplacePlanSearchRequest,
  MarketplacePlanSearchResponse,
  MarketplaceProviderCoverage,
  MarketplaceProviderSuggestion,
} from "./types";

const DEFAULT_BASE = "https://marketplace.api.healthcare.gov/api/v1";

export class MarketplaceConfigError extends Error {}
export class MarketplaceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MarketplaceClientOptions {
  apiKey?: string;
  baseUrl?: string;
  /** Inject `fetch` for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Cache GET responses to disk under data/cache (default true). */
  useCache?: boolean;
}

export class MarketplaceClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly useCache: boolean;

  constructor(opts: MarketplaceClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.MARKETPLACE_API_KEY?.trim();
    this.baseUrl = (opts.baseUrl ?? process.env.MARKETPLACE_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.useCache = opts.useCache ?? true;
  }

  /** True when a key is configured and live calls will be attempted. */
  get isLive(): boolean {
    return Boolean(this.apiKey);
  }

  private requireKey(): string {
    if (!this.apiKey) {
      throw new MarketplaceConfigError(
        "MARKETPLACE_API_KEY is not set — request a free key at developer.cms.gov/marketplace-api.",
      );
    }
    return this.apiKey;
  }

  private url(pathname: string): string {
    const key = this.requireKey();
    const u = new URL(this.baseUrl + pathname);
    u.searchParams.set("apikey", key);
    return u.toString();
  }

  private async getJson<T>(pathname: string): Promise<T> {
    const doFetch = async (): Promise<T> => {
      const res = await this.fetchImpl(this.url(pathname), { headers: { accept: "application/json" } });
      if (!res.ok) throw new MarketplaceApiError(`GET ${pathname} → ${res.status}`, res.status);
      return (await res.json()) as T;
    };
    return this.useCache ? cached<T>("marketplace-get", pathname, doFetch) : doFetch();
  }

  private async postJson<T>(pathname: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(this.url(pathname), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new MarketplaceApiError(`POST ${pathname} → ${res.status}`, res.status);
    return (await res.json()) as T;
  }

  /** Resolve a ZIP to its county/rating-area candidates (a ZIP can span counties). */
  async countiesByZip(zip: string): Promise<MarketplaceCounty[]> {
    const data = await this.getJson<MarketplaceCountiesResponse>(`/counties/by/zip/${encodeURIComponent(zip)}`);
    return data.counties ?? [];
  }

  /** Plan search. Pass `providers`/`drugs` in the request to get per-plan coverage flags back. */
  async searchPlans(req: MarketplacePlanSearchRequest): Promise<MarketplacePlanSearchResponse> {
    return this.postJson<MarketplacePlanSearchResponse>("/plans/search", req);
  }

  /** Eligibility + subsidy (APTC/CSR) estimate for a household. Validated against KFF in M2. */
  async estimateEligibility(body: {
    household: MarketplacePlanSearchRequest["household"];
    place: MarketplacePlanSearchRequest["place"];
    year: number;
  }): Promise<MarketplaceEligibilityResponse> {
    return this.postJson<MarketplaceEligibilityResponse>("/households/eligibility/estimates", body);
  }

  /**
   * Per-(provider, plan) in-network status via `/providers/covered`. The live API does NOT inline
   * coverage in plan search — it is checked here against a set of plan ids. Plan-id batches are chunked
   * to keep the URL within limits. Each result carries `plan_id`, so callers group by plan.
   */
  async providersCovered(providerIds: string[], planIds: string[], year: number): Promise<MarketplaceProviderCoverage[]> {
    return this.coverageBatched<MarketplaceProviderCoverage>("/providers/covered", "providerids", providerIds, planIds, year);
  }

  /** Per-(drug, plan) formulary status via `/drugs/covered`. Same batching as {@link providersCovered}. */
  async drugsCovered(rxcuis: string[], planIds: string[], year: number): Promise<MarketplaceDrugCoverage[]> {
    return this.coverageBatched<MarketplaceDrugCoverage>("/drugs/covered", "drugs", rxcuis, planIds, year);
  }

  /** Drug name → specific-product suggestions (`/drugs/autocomplete`) — the formulary-correct RxCUIs. */
  async drugsAutocomplete(q: string): Promise<MarketplaceDrugSuggestion[]> {
    if (!q.trim()) return [];
    const data = await this.getJson<MarketplaceDrugSuggestion[]>(`/drugs/autocomplete?q=${encodeURIComponent(q)}`);
    return Array.isArray(data) ? data : [];
  }

  /** Provider name → NPI suggestions near a ZIP (`/providers/autocomplete`). */
  async providersAutocomplete(q: string, zipcode: string, year: number): Promise<MarketplaceProviderSuggestion[]> {
    if (!q.trim() || !zipcode) return [];
    const data = await this.getJson<MarketplaceProviderSuggestion[]>(
      `/providers/autocomplete?q=${encodeURIComponent(q)}&zipcode=${encodeURIComponent(zipcode)}&type=Individual&year=${year}`,
    );
    return Array.isArray(data) ? data : [];
  }

  private async coverageBatched<T>(
    path: string,
    subjectParam: "providerids" | "drugs",
    subjectIds: string[],
    planIds: string[],
    year: number,
    chunkSize = 10, // the live API rejects much larger plan-id batches with a 400
  ): Promise<T[]> {
    if (subjectIds.length === 0 || planIds.length === 0) return [];
    const out: T[] = [];
    for (let i = 0; i < planIds.length; i += chunkSize) {
      const chunk = planIds.slice(i, i + chunkSize);
      const q = `${subjectParam}=${subjectIds.join(",")}&planids=${chunk.join(",")}&year=${year}`;
      const data = await this.getJson<{ coverage?: T[] }>(`${path}?${q}`);
      if (data.coverage) out.push(...data.coverage);
    }
    return out;
  }
}

/**
 * Map a Marketplace API provider-coverage flag to a provenance-wrapped answer.
 * "Covered" → yes, "NotCovered" → no, anything else (including missing) → unknown. Crucially, an
 * absent flag is `unknown`, never `no` — silence is not a denial.
 */
export function providerCoverageToAnswer(
  cov: MarketplaceProviderCoverage,
  fetchedAt: string,
  sourceUrl?: string,
): CoverageAnswer {
  return makeCoverageAnswer({
    value: coverageStringToTristate(cov.coverage),
    source: "MARKETPLACE_API",
    fetchedAt,
    sourceUrl,
    subjectLabel: cov.name ? `${cov.name} (NPI ${cov.npi})` : `NPI ${cov.npi}`,
  });
}

/** Map a Marketplace API drug-coverage flag (with tier) to a provenance-wrapped answer. */
export function drugCoverageToAnswer(
  cov: MarketplaceDrugCoverage,
  fetchedAt: string,
  sourceUrl?: string,
): CoverageAnswer {
  return makeCoverageAnswer({
    value: coverageStringToTristate(cov.coverage),
    source: "MARKETPLACE_API",
    fetchedAt,
    sourceUrl,
    formularyTier: cov.drug_tier,
    subjectLabel: cov.name ? `${cov.name} (RxCUI ${cov.rxcui})` : `RxCUI ${cov.rxcui}`,
  });
}

export function coverageStringToTristate(s: string | undefined): "yes" | "no" | "unknown" {
  if (!s) return "unknown";
  const v = s.toLowerCase();
  if (v.includes("notcovered") || v === "not covered" || v === "out") return "no";
  if (v.includes("covered") || v === "in") return "yes";
  return "unknown";
}
