/**
 * TiC adapter — turns the thin network-membership index (S4) into doctrine-shaped CoverageAnswers,
 * so the commercial layer speaks the same provenance language as every other source.
 *
 * Semantics (mirrors the documented issuer-MRF rule):
 *   - NPI listed in ≥1 indexed file serving the plan  → "yes", freshness = the freshest such file.
 *   - Plan's files ARE indexed but the NPI is absent   → "no" — the issuer's own file omits them.
 *   - Plan not in the index at all                     → honest "unknown", never a silent "no".
 *
 * The core is pure (unit-testable, eval-able without a database); `queryTicAnswer` is the thin
 * Prisma edge that feeds it from the live index.
 */
import { makeCoverageAnswer, type CoverageAnswer } from "@/lib/provenance";
import { prisma } from "@/lib/prisma";

export interface TicFileHit {
  url: string;
  /** The file's own last_updated_on, when known (ISO 8601 / Date). */
  sourceLastUpdated?: string;
}

export interface TicLookup {
  npi: string;
  /** Was the plan found in the index at all (any TicPlanLink rows)? */
  planIndexed: boolean;
  /** Files serving the plan that list this NPI (empty + planIndexed=true ⇒ definite "no"). */
  matchedFiles: TicFileHit[];
  /** When our pipeline performed this lookup (ISO 8601). */
  fetchedAt: string;
  subjectLabel?: string;
}

/** Pure core: index lookup result → provenance-wrapped answer. The ONLY way TiC data becomes a claim. */
export function buildTicAnswer(lookup: TicLookup): CoverageAnswer {
  const { matchedFiles, planIndexed, fetchedAt, subjectLabel } = lookup;
  if (!planIndexed) {
    return makeCoverageAnswer({
      value: "unknown",
      source: "ISSUER_TIC_MRF",
      fetchedAt,
      subjectLabel,
    });
  }
  const freshest = matchedFiles
    .map((f) => f.sourceLastUpdated)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  return makeCoverageAnswer({
    value: matchedFiles.length > 0 ? "yes" : "no",
    source: "ISSUER_TIC_MRF",
    fetchedAt,
    sourceUrl: matchedFiles[0]?.url,
    sourceLastUpdated: freshest,
    subjectLabel,
  });
}

/**
 * Live edge: answer "is this NPI in-network on this plan?" from the loaded index.
 * `planIdType` is "EIN" (employer group) or "HIOS" (individual market), as the TOC reports it.
 */
export async function queryTicAnswer(args: {
  npi: string;
  planIdType: string;
  planId: string;
  subjectLabel?: string;
  db?: typeof prisma;
}): Promise<CoverageAnswer> {
  const db = args.db ?? prisma;
  const fetchedAt = new Date().toISOString();

  const links = await db.ticPlanLink.findMany({
    where: { planIdType: args.planIdType, planId: args.planId },
    select: { fileId: true },
  });
  const fileIds = [...new Set(links.map((l) => l.fileId))];
  if (fileIds.length === 0) {
    return buildTicAnswer({ npi: args.npi, planIndexed: false, matchedFiles: [], fetchedAt, subjectLabel: args.subjectLabel });
  }

  const hits = await db.ticMembership.findMany({
    where: { npi: args.npi, fileId: { in: fileIds } },
    select: { file: { select: { url: true, sourceLastUpdated: true } } },
  });
  const matchedFiles: TicFileHit[] = [...new Map(hits.map((h) => [h.file.url, h])).values()].map((h) => ({
    url: h.file.url,
    sourceLastUpdated: h.file.sourceLastUpdated?.toISOString(),
  }));

  return buildTicAnswer({ npi: args.npi, planIndexed: true, matchedFiles, fetchedAt, subjectLabel: args.subjectLabel });
}
