/**
 * Provenance primitives — the doctrine, in code.
 *
 * Non-negotiable: [affinity.] never presents "in-network" or "on-formulary" as ground truth.
 * Every coverage answer is a {@link CoverageAnswer}: a tri-state value (`yes` | `no` | `unknown`)
 * wrapped with where it came from, how fresh it is, and how much to trust it. This module is the
 * single place that builds those wrappers and the single place that renders a claim to human text —
 * so a bare boolean can never leak to a surface. The matching engine (M1), cost engine (M2), and
 * verification layer (M3) all speak in these types.
 */

/** Origin of a coverage datum. Mirrors the Prisma `CoverageSource` enum. */
export type SourceTag = "MARKETPLACE_API" | "ISSUER_MRF" | "ISSUER_TIC_MRF" | "CROWD" | "SECRET_SHOPPER";

/** Tri-state answer. `unknown` is a first-class, honest result — never coerce it to `no`. */
export type Tristate = "yes" | "no" | "unknown";

/** Where a single datum came from and when we saw it. */
export interface Provenance {
  source: SourceTag;
  /** URL the datum was fetched from, when applicable. */
  sourceUrl?: string;
  /** When [affinity.] fetched it (ISO 8601). */
  fetchedAt: string;
  /** Freshness the source itself reports, e.g. an MRF `last_updated_on` (ISO 8601), if known. */
  sourceLastUpdated?: string;
}

/**
 * A coverage assertion with full provenance. The only shape any surface is allowed to show.
 * `confidence` is 0..1 *before* cross-source reconciliation; the M3 layer adjusts it using
 * `agreesWith` / `conflictsWith`.
 */
export interface CoverageAnswer {
  value: Tristate;
  /** Human-meaningful subject, e.g. "Dr. Jane Smith (NPI 1234567890)" or "atorvastatin 20mg". */
  subjectLabel?: string;
  /** Formulary tier when the subject is a drug and it is on formulary. */
  formularyTier?: string;
  provenance: Provenance;
  confidence: number;
  agreesWith?: SourceTag[];
  conflictsWith?: SourceTag[];
}

/** Default confidence weights per source before reconciliation. Tunable as we learn. */
export const BASE_CONFIDENCE: Record<SourceTag, number> = {
  // The issuer MRF is the closest thing to "the issuer's own word" but is documented to be buggy.
  ISSUER_MRF: 0.6,
  // The Transparency-in-Coverage in-network file: the same "issuer's own word" class for
  // commercial/employer plans (federally mandated, monthly). Same trust tier as the QHP MRF.
  ISSUER_TIC_MRF: 0.6,
  // The Marketplace API derives from issuer data and lags; treat as corroborating, not gospel.
  MARKETPLACE_API: 0.55,
  // Crowd + secret-shopper land in M5; a real-world confirmation outranks a file.
  SECRET_SHOPPER: 0.85,
  CROWD: 0.5,
};

/** How stale a datum can be before we discount its confidence (days). */
const FRESHNESS_HALF_LIFE_DAYS = 90;

/**
 * Build a provenance-wrapped answer. This is the ONLY constructor for a coverage claim — call sites
 * cannot assemble one ad hoc, which is what keeps bare booleans out of the system.
 */
export function makeCoverageAnswer(args: {
  value: Tristate;
  source: SourceTag;
  fetchedAt: string;
  subjectLabel?: string;
  formularyTier?: string;
  sourceUrl?: string;
  sourceLastUpdated?: string;
  /** Override the computed confidence (otherwise derived from source + freshness). */
  confidence?: number;
}): CoverageAnswer {
  const base = BASE_CONFIDENCE[args.source];
  const freshness = freshnessMultiplier(args.fetchedAt, args.sourceLastUpdated);
  // An "unknown" answer carries near-zero confidence regardless of source.
  const computed = args.value === "unknown" ? 0.05 : round2(base * freshness);
  return {
    value: args.value,
    subjectLabel: args.subjectLabel,
    formularyTier: args.formularyTier,
    provenance: {
      source: args.source,
      sourceUrl: args.sourceUrl,
      fetchedAt: args.fetchedAt,
      sourceLastUpdated: args.sourceLastUpdated,
    },
    confidence: args.confidence ?? computed,
  };
}

/** Exponential freshness decay: 1.0 when fresh, → 0 as the source's last-update recedes. */
function freshnessMultiplier(fetchedAt: string, sourceLastUpdated?: string): number {
  const anchor = sourceLastUpdated ?? fetchedAt;
  const ageMs = Date.parse(fetchedAt) - Date.parse(anchor);
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const ageDays = ageMs / 86_400_000;
  return Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

/**
 * Render a coverage answer to honest human text. There is intentionally NO code path that returns a
 * naked "in-network" — every rendering names the source, the freshness, the confidence, and (for
 * anything but high-confidence agreement) tells the user to confirm with the provider's office.
 */
export function renderCoverageAnswer(a: CoverageAnswer): string {
  const subject = a.subjectLabel ? `${a.subjectLabel}: ` : "";
  const verb =
    a.value === "yes"
      ? a.formularyTier
        ? `on formulary (tier ${a.formularyTier})`
        : "shown in-network"
      : a.value === "no"
        ? "shown NOT covered"
        : "coverage unknown";
  const src = sourceLabel(a.provenance.source);
  const fresh = a.provenance.sourceLastUpdated
    ? `, source updated ${a.provenance.sourceLastUpdated.slice(0, 10)}`
    : "";
  const conf = `${Math.round(a.confidence * 100)}% confidence`;
  const conflict = a.conflictsWith?.length
    ? ` ⚠️ conflicts with ${a.conflictsWith.map(sourceLabel).join(", ")}`
    : "";
  const confirm = needsConfirmation(a) ? " — confirm with the provider's office before enrolling." : "";
  return `${subject}${verb} per ${src}${fresh} (${conf})${conflict}.${confirm}`;
}

/** A claim needs human confirmation unless it is high-confidence AND uncontested. */
export function needsConfirmation(a: CoverageAnswer): boolean {
  if (a.value === "unknown") return true;
  if (a.conflictsWith && a.conflictsWith.length > 0) return true;
  return a.confidence < 0.8;
}

function sourceLabel(s: SourceTag): string {
  switch (s) {
    case "MARKETPLACE_API":
      return "the Marketplace API";
    case "ISSUER_MRF":
      return "the issuer's machine-readable file";
    case "ISSUER_TIC_MRF":
      return "the issuer's Transparency-in-Coverage file";
    case "CROWD":
      return "crowd reports";
    case "SECRET_SHOPPER":
      return "a secret-shopper check";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
