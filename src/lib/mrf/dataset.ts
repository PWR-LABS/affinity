/**
 * In-memory index over an issuer's provider/drug MRF records, with provenance-aware lookups.
 *
 * `MrfDataset` answers the two questions the reconciliation diff asks: "is NPI X in-network on plan
 * Y?" and "is RxCUI Z on plan Y's formulary, and at what tier?" — as tri-state {@link CoverageAnswer}s
 * tagged `ISSUER_MRF` and stamped with the file's own `last_updated_on` freshness.
 *
 * Honesty rules (these encode the doctrine — silence is not denial):
 *   - subject PRESENT in the file AND the plan listed     → `yes`
 *   - subject PRESENT but the plan NOT listed             → `no`  (issuer's own file omits this plan)
 *   - subject ABSENT from the file entirely               → `unknown` (file may be incomplete/buggy)
 */
import { makeCoverageAnswer, type CoverageAnswer } from "@/lib/provenance";

import type { MrfDrug, MrfProvider } from "./types";

export class MrfDataset {
  private readonly providersByNpi = new Map<string, MrfProvider>();
  private readonly drugsByRxcui = new Map<string, MrfDrug>();

  constructor(
    providers: MrfProvider[],
    drugs: MrfDrug[],
    /** When [affinity.] fetched these files (ISO 8601). */
    readonly fetchedAt: string,
    /** Source URLs for provenance, if fetched from the network. */
    readonly sourceUrls: { providers?: string; drugs?: string } = {},
  ) {
    // Real issuer files are partially malformed (tens of thousands of documented import errors), so
    // skip non-object/keyless records and normalize the join keys rather than trusting the shape.
    for (const p of providers) {
      const npi = normalizeKey((p as MrfProvider | null)?.npi);
      if (npi) this.providersByNpi.set(npi, p);
    }
    for (const d of drugs) {
      const rxcui = normalizeKey((d as MrfDrug | null)?.rxnorm_id);
      if (rxcui) this.drugsByRxcui.set(rxcui, d);
    }
  }

  get providerCount(): number {
    return this.providersByNpi.size;
  }
  get drugCount(): number {
    return this.drugsByRxcui.size;
  }

  /** Tri-state in-network answer for a provider on a specific plan. */
  providerAnswer(npi: string, planId: string): CoverageAnswer {
    const rec = this.providersByNpi.get(normalizeKey(npi));
    const subjectLabel = providerLabel(rec, npi);
    if (!rec) {
      return makeCoverageAnswer({
        value: "unknown",
        source: "ISSUER_MRF",
        fetchedAt: this.fetchedAt,
        sourceUrl: this.sourceUrls.providers,
        subjectLabel,
      });
    }
    const match = safePlans(rec.plans).find((p) => p?.plan_id === planId);
    return makeCoverageAnswer({
      value: match ? "yes" : "no",
      source: "ISSUER_MRF",
      fetchedAt: this.fetchedAt,
      sourceUrl: this.sourceUrls.providers,
      sourceLastUpdated: rec.last_updated_on,
      subjectLabel,
    });
  }

  /** Tri-state on-formulary answer (with tier) for a drug on a specific plan. */
  drugAnswer(rxcui: string, planId: string): CoverageAnswer {
    const rec = this.drugsByRxcui.get(normalizeKey(rxcui));
    const subjectLabel = drugLabel(rec, rxcui);
    if (!rec) {
      return makeCoverageAnswer({
        value: "unknown",
        source: "ISSUER_MRF",
        fetchedAt: this.fetchedAt,
        sourceUrl: this.sourceUrls.drugs,
        subjectLabel,
      });
    }
    const match = safePlans(rec.plans).find((p) => p?.plan_id === planId);
    return makeCoverageAnswer({
      value: match ? "yes" : "no",
      source: "ISSUER_MRF",
      fetchedAt: this.fetchedAt,
      sourceUrl: this.sourceUrls.drugs,
      sourceLastUpdated: rec.last_updated_on,
      formularyTier: match?.drug_tier,
      subjectLabel,
    });
  }
}

/** Normalize a join key (NPI/RxCUI) that may arrive as a number, padded, or whitespace-wrapped. */
function normalizeKey(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/** Tolerate a malformed `plans` field that is missing, null, or not an array. */
function safePlans<T>(plans: T[] | undefined): T[] {
  return Array.isArray(plans) ? plans : [];
}

function providerLabel(rec: MrfProvider | undefined, npi: string): string {
  if (!rec?.name) return `NPI ${npi}`;
  if (typeof rec.name === "string") return `${rec.name} (NPI ${npi})`;
  const full = [rec.name.first, rec.name.last].filter(Boolean).join(" ").trim();
  return full ? `${full} (NPI ${npi})` : `NPI ${npi}`;
}

function drugLabel(rec: MrfDrug | undefined, rxcui: string): string {
  return rec?.drug_name ? `${rec.drug_name} (RxCUI ${rxcui})` : `RxCUI ${rxcui}`;
}
