import {fileLinksForPlan} from './shared-plans';
import {bucketContains,COMPACT_FORMAT} from './compact-codec';
/**
 * TiC adapter — turns the thin network-membership index (S4) into doctrine-shaped CoverageAnswers,
 * so the commercial layer speaks the same provenance language as every other source.
 *
 * Matches report source listings only. An incomplete index can never establish absence.
 * No current importer certifies completeness, so this adapter never emits "no".
 * Undated, future-dated and stale source matches remain unknown.
 *
 * The core is pure (unit-testable, eval-able without a database); `queryTicAnswer` is the thin
 * Prisma edge that feeds it from the live index.
 */
import { makeCoverageAnswer, type CoverageAnswer } from "@/lib/provenance";
import { ticSourceCurrent } from "@/lib/tic/freshness";
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
  /** Files serving the plan that list this NPI (absence never establishes non-coverage). */
  matchedFiles: TicFileHit[];
  /** All indexed files for this identifier, including files without a provider match. */
  indexedFiles?: TicFileHit[];
  /** When our pipeline performed this lookup (ISO 8601). */
  fetchedAt: string;
  subjectLabel?: string;
}

export type TicEvidenceStatus = "listed" | "plan_missing" | "incomplete_index" | "source_stale" | "source_date_unknown";
export type TicAnswer = CoverageAnswer & { evidenceStatus: TicEvidenceStatus; explanation: string };

const EXPLANATIONS: Record<TicEvidenceStatus, string> = {
  listed: "This provider appears in a recent issuer file associated with this identifier. An employer identifier can cover multiple plans; confirm your exact plan and network with the insurer and provider.",
  plan_missing: "We have no issuer files for this plan or employer identifier. This does not mean the doctor is out of network.",
  incomplete_index: "We did not find this provider in the files we hold. We have not verified that those files cover the whole plan, so absence is not an out-of-network result.",
  source_stale: "The available source evidence is older than our 60-day limit. It cannot establish current network status.",
  source_date_unknown: "The available source evidence has a missing, invalid, or future update date. It cannot establish current network status.",
};

/** Fail closed: neither a file link nor a completed lookup proves a complete plan index. */
export function buildTicAnswer(lookup: TicLookup): TicAnswer {
  const { matchedFiles, planIndexed, fetchedAt, subjectLabel } = lookup;
  const current = matchedFiles.filter(f => ticSourceCurrent(f.sourceLastUpdated, fetchedAt))
    .sort((a, b) => Date.parse(b.sourceLastUpdated!) - Date.parse(a.sourceLastUpdated!));
  const evidence = matchedFiles.length ? matchedFiles : lookup.indexedFiles ?? [];
  let evidenceStatus: TicEvidenceStatus;
  if (!planIndexed) evidenceStatus = "plan_missing";
  else if (current.length) evidenceStatus = "listed";
  else if (evidence.length && !evidence.some(f => ticSourceCurrent(f.sourceLastUpdated, fetchedAt))) {
    evidenceStatus = evidence.some(f => !Number.isFinite(Date.parse(f.sourceLastUpdated ?? "")) || Date.parse(f.sourceLastUpdated!) > Date.parse(fetchedAt))
      ? "source_date_unknown" : "source_stale";
  } else evidenceStatus = "incomplete_index";
  // Keep URL and date from the SAME source, including when explaining withheld evidence.
  const source = current[0] ?? evidence[0];
  return {
    ...makeCoverageAnswer({
      value: evidenceStatus === "listed" ? "yes" : "unknown",
      source: "ISSUER_TIC_MRF", fetchedAt, subjectLabel,
      sourceUrl: source?.url, sourceLastUpdated: source?.sourceLastUpdated,
    }),
    evidenceStatus,
    explanation: EXPLANATIONS[evidenceStatus],
  };
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
}): Promise<TicAnswer> {
  const db = args.db ?? prisma;
  const fetchedAt = new Date().toISOString();

  const links = await fileLinksForPlan(db,args.planIdType,args.planId);
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

  // Bound decompression per request. An unexamined/corrupt bucket cannot prove absence.
  let decodedBudget=16_000_000;
  if(/^\d{10}$/.test(args.npi))for(let offset=0;offset<fileIds.length&&decodedBudget>0;offset+=4){
    const buckets=await db.ticNpiBucket.findMany({where:{fileId:{in:fileIds.slice(offset,offset+4)},prefix:args.npi.slice(0,4),index:{format:COMPACT_FORMAT}},take:4});
    for(const bucket of buckets){
      if(bucket.count*4>decodedBudget)continue;
      decodedBudget-=bucket.count*4;
      try{if(bucketContains(bucket,args.npi)){const link=links.find(l=>l.fileId===bucket.fileId);if(link)matchedFiles.push({url:link.file.url,sourceLastUpdated:link.file.sourceLastUpdated?.toISOString()});}}catch{/* Withhold corrupt evidence. */}
    }
    if(matchedFiles.some(f=>ticSourceCurrent(f.sourceLastUpdated,fetchedAt)))break;
  }

  return buildTicAnswer({ npi: args.npi, planIndexed: true, matchedFiles, indexedFiles: links.map(l => ({ url: l.file.url, sourceLastUpdated: l.file.sourceLastUpdated?.toISOString() })), fetchedAt, subjectLabel: args.subjectLabel });
}
