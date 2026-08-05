/**
 * Part D adapter — turns the CMS Part D formulary index into doctrine-shaped CoverageAnswers, and
 * surfaces the utilization-management fields (prior auth / step therapy / quantity limit) published in
 * the CMS Part D PUF. Same shape as the TiC adapter: pure core (unit-testable, eval-able without a DB) +
 * a thin Prisma edge.
 *
 * Semantics:
 *   - Plan's formulary lists the RxCUI          → "yes" (on formulary), with tier + UM flags.
 *   - Formulary IS indexed but the RxCUI is absent → "no" (not on this plan's formulary).
 *   - Plan/formulary not in the index            → honest "unknown", never a silent "no".
 */
import { makeCoverageAnswer, type CoverageAnswer } from "@/lib/provenance";
import { prisma } from "@/lib/prisma";

export interface PartDDrugRow {
  tier?: number;
  priorAuthorization?: boolean;
  stepTherapy?: boolean;
  quantityLimit?: boolean;
}

export interface PartDLookup {
  rxcui: string;
  /** Was the plan's formulary found in the index at all? */
  formularyIndexed: boolean;
  /** The formulary's row for this drug, if listed (undefined + formularyIndexed=true ⇒ "no"). */
  drug?: PartDDrugRow;
  /** ISO 8601 of when our pipeline built this answer. */
  fetchedAt: string;
  /** The formulary file's report date (YYYY-MM-DD), if known. */
  sourceLastUpdated?: string;
  subjectLabel?: string;
}

export interface PartDAnswer {
  answer: CoverageAnswer;
  /** Utilization-management flags — present only when the drug is on formulary. */
  um: PartDDrugRow;
}

/** Pure core: formulary lookup → provenance-wrapped answer + UM flags. */
export function buildPartDAnswer(lookup: PartDLookup): PartDAnswer {
  const { drug, formularyIndexed, fetchedAt, sourceLastUpdated, subjectLabel } = lookup;
  if (!formularyIndexed) {
    return {
      answer: makeCoverageAnswer({ value: "unknown", source: "CMS_PARTD", fetchedAt, subjectLabel }),
      um: {},
    };
  }
  const onFormulary = Boolean(drug);
  return {
    answer: makeCoverageAnswer({
      value: onFormulary ? "yes" : "no",
      source: "CMS_PARTD",
      fetchedAt,
      sourceLastUpdated,
      subjectLabel,
      formularyTier: onFormulary && typeof drug?.tier === "number" ? String(drug.tier) : undefined,
    }),
    um: onFormulary ? { tier: drug?.tier, priorAuthorization: drug?.priorAuthorization, stepTherapy: drug?.stepTherapy, quantityLimit: drug?.quantityLimit } : {},
  };
}

/** Live edge: "is this RxCUI on this Part D plan's formulary?" from the loaded index. */
export async function queryPartDAnswer(args: {
  rxcui: string;
  contractId: string;
  planId: string;
  segmentId: string;
  contractYear: number;
  subjectLabel?: string;
  db?: typeof prisma;
}): Promise<PartDAnswer> {
  const db = args.db ?? prisma;
  const fetchedAt = new Date().toISOString();

  const plan = await db.partDPlan.findUnique({
    where: {
      contractId_planId_segmentId_contractYear: {
        contractId: args.contractId,
        planId: args.planId,
        segmentId: args.segmentId,
        contractYear: args.contractYear,
      },
    },
    select: { formularyId: true },
  });
  if (!plan) {
    return buildPartDAnswer({ rxcui: args.rxcui, formularyIndexed: false, fetchedAt, subjectLabel: args.subjectLabel });
  }

  const row = await db.partDFormularyDrug.findUnique({
    where: { formularyId_contractYear_rxcui: { formularyId: plan.formularyId, contractYear: args.contractYear, rxcui: args.rxcui } },
    select: { tier: true, priorAuthorization: true, stepTherapy: true, quantityLimit: true },
  });

  return buildPartDAnswer({
    rxcui: args.rxcui,
    formularyIndexed: true,
    drug: row
      ? {
          tier: row.tier ?? undefined,
          priorAuthorization: row.priorAuthorization ?? undefined,
          stepTherapy: row.stepTherapy ?? undefined,
          quantityLimit: row.quantityLimit ?? undefined,
        }
      : undefined,
    fetchedAt,
    subjectLabel: args.subjectLabel,
  });
}
