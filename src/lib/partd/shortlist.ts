import { BASE_CONFIDENCE } from "@/lib/provenance";
import { prisma } from "@/lib/prisma";

export const PARTD_SHORTLIST_LIMIT = 12;

export interface PartDShortlistPlanInput {
  contractId: string;
  planId: string;
  segmentId: string;
  contractYear: number;
  planName: string;
  formularyId: string;
  state: string | null;
  pdpRegionCode?: string | null;
}

export interface PartDShortlistDrugInput {
  formularyId: string;
  rxcui: string;
  tier: number | null;
  priorAuthorization: boolean | null;
  stepTherapy: boolean | null;
  quantityLimit: boolean | null;
}

export interface PartDShortlistDrug {
  rxcui: string;
  value: "yes" | "no";
  tier: number | null;
  priorAuthorization?: boolean;
  stepTherapy?: boolean;
  quantityLimit?: boolean;
}

export interface PartDShortlistPlan {
  contractId: string;
  planId: string;
  segmentId: string;
  contractYear: number;
  planName: string;
  state: string | null;
  listedCount: number;
  medicationCount: number;
  restrictedDrugCount: number;
  restrictionFlagCount: number;
  averageTier: number | null;
  drugs: PartDShortlistDrug[];
}

function optionalBoolean(value: boolean | null): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function isStandalonePartDContract(contractId: string): boolean {
  return /^S\d{4}$/.test(contractId);
}

const PDP_REGION_STATES: Record<string, readonly string[]> = {
  "1": ["NH", "ME"],
  "2": ["CT", "MA", "RI", "VT"],
  "3": ["NY"],
  "4": ["NJ"],
  "5": ["DE", "DC", "MD"],
  "6": ["PA", "WV"],
  "7": ["VA"],
  "8": ["NC"],
  "9": ["SC"],
  "10": ["GA"],
  "11": ["FL"],
  "12": ["AL", "TN"],
  "13": ["MI"],
  "14": ["OH"],
  "15": ["IN", "KY"],
  "16": ["WI"],
  "17": ["IL"],
  "18": ["MO"],
  "19": ["AR"],
  "20": ["MS"],
  "21": ["LA"],
  "22": ["TX"],
  "23": ["OK"],
  "24": ["KS"],
  "25": ["IA", "MN", "MT", "NE", "ND", "SD", "WY"],
  "26": ["NM"],
  "27": ["CO"],
  "28": ["AZ"],
  "29": ["NV"],
  "30": ["OR", "WA"],
  "31": ["ID", "UT"],
  "32": ["CA"],
  "33": ["HI"],
  "34": ["AK"],
  "35": ["AS"],
  "36": ["GU"],
  "37": ["MP"],
  "38": ["PR"],
  "39": ["VI"],
};

export function pdpRegionCodeForState(state: string): string | null {
  const normalized = state.trim().toUpperCase();
  for (const [regionCode, states] of Object.entries(PDP_REGION_STATES)) {
    if (states.includes(normalized)) return regionCode;
  }
  return null;
}

export function rankPartDShortlist(args: {
  plans: PartDShortlistPlanInput[];
  formularyDrugs: PartDShortlistDrugInput[];
  rxcuis: string[];
}): PartDShortlistPlan[] {
  const rxcuis = [...new Set(args.rxcuis)];
  const rowsByFormulary = new Map<string, Map<string, PartDShortlistDrugInput>>();

  for (const row of args.formularyDrugs) {
    let rows = rowsByFormulary.get(row.formularyId);
    if (!rows) {
      rows = new Map();
      rowsByFormulary.set(row.formularyId, rows);
    }
    if (!rows.has(row.rxcui)) rows.set(row.rxcui, row);
  }

  return args.plans
    .filter((plan) => isStandalonePartDContract(plan.contractId))
    .map((plan): PartDShortlistPlan => {
      const formularyRows = rowsByFormulary.get(plan.formularyId);
      const drugs = rxcuis.map((rxcui): PartDShortlistDrug => {
        const row = formularyRows?.get(rxcui);
        if (!row) return { rxcui, value: "no", tier: null };
        return {
          rxcui,
          value: "yes",
          tier: row.tier,
          priorAuthorization: optionalBoolean(row.priorAuthorization),
          stepTherapy: optionalBoolean(row.stepTherapy),
          quantityLimit: optionalBoolean(row.quantityLimit),
        };
      });
      const listed = drugs.filter((drug) => drug.value === "yes");
      const tierValues = listed.flatMap((drug) => (typeof drug.tier === "number" ? [drug.tier] : []));
      const restrictedDrugCount = listed.filter(
        (drug) => drug.priorAuthorization || drug.stepTherapy || drug.quantityLimit,
      ).length;
      const restrictionFlagCount = listed.reduce(
        (total, drug) =>
          total +
          Number(drug.priorAuthorization === true) +
          Number(drug.stepTherapy === true) +
          Number(drug.quantityLimit === true),
        0,
      );

      return {
        contractId: plan.contractId,
        planId: plan.planId,
        segmentId: plan.segmentId,
        contractYear: plan.contractYear,
        planName: plan.planName,
        state: plan.state,
        listedCount: listed.length,
        medicationCount: drugs.length,
        restrictedDrugCount,
        restrictionFlagCount,
        averageTier: tierValues.length
          ? Math.round((tierValues.reduce((total, tier) => total + tier, 0) / tierValues.length) * 10) / 10
          : null,
        drugs,
      };
    })
    .sort((a, b) => {
      if (a.listedCount !== b.listedCount) return b.listedCount - a.listedCount;
      if (a.restrictedDrugCount !== b.restrictedDrugCount) {
        return a.restrictedDrugCount - b.restrictedDrugCount;
      }
      if (a.restrictionFlagCount !== b.restrictionFlagCount) {
        return a.restrictionFlagCount - b.restrictionFlagCount;
      }
      const aTier = a.averageTier ?? Number.POSITIVE_INFINITY;
      const bTier = b.averageTier ?? Number.POSITIVE_INFINITY;
      if (aTier !== bTier) return aTier - bTier;
      return (
        a.planName.localeCompare(b.planName) ||
        a.contractId.localeCompare(b.contractId) ||
        a.planId.localeCompare(b.planId) ||
        a.segmentId.localeCompare(b.segmentId)
      );
    });
}

export async function queryPartDShortlist(args: {
  state: string;
  rxcuis: string[];
  contractYear: number;
  limit?: number;
  db?: typeof prisma;
}) {
  const db = args.db ?? prisma;
  const state = args.state.toUpperCase();
  const rxcuis = [...new Set(args.rxcuis)];
  const pdpRegionCode = pdpRegionCodeForState(state);
  if (!pdpRegionCode) {
    return {
      state,
      contractYear: args.contractYear,
      medicationCount: rxcuis.length,
      plansEvaluated: 0,
      source: "CMS_PARTD" as const,
      sourceUpdated: null,
      checkedAt: new Date().toISOString(),
      confidence: BASE_CONFIDENCE.CMS_PARTD,
      plans: [],
    };
  }
  const plans = await db.partDPlan.findMany({
    where: {
      contractYear: args.contractYear,
      contractId: { startsWith: "S" },
      pdpRegionCode,
    },
    orderBy: [{ planName: "asc" }, { contractId: "asc" }, { planId: "asc" }, { segmentId: "asc" }],
    select: {
      contractId: true,
      planId: true,
      segmentId: true,
      contractYear: true,
      planName: true,
      formularyId: true,
      state: true,
      pdpRegionCode: true,
    },
  });

  const formularyIds = [...new Set(plans.map((plan) => plan.formularyId))];
  const formularyDrugs = formularyIds.length
    ? await db.partDFormularyDrug.findMany({
        where: {
          contractYear: args.contractYear,
          formularyId: { in: formularyIds },
          rxcui: { in: rxcuis },
        },
        select: {
          formularyId: true,
          rxcui: true,
          tier: true,
          priorAuthorization: true,
          stepTherapy: true,
          quantityLimit: true,
        },
      })
    : [];
  const ranked = rankPartDShortlist({ plans, formularyDrugs, rxcuis });

  return {
    state,
    contractYear: args.contractYear,
    medicationCount: rxcuis.length,
    plansEvaluated: ranked.length,
    source: "CMS_PARTD" as const,
    sourceUpdated: null,
    checkedAt: new Date().toISOString(),
    confidence: BASE_CONFIDENCE.CMS_PARTD,
    plans: ranked.slice(0, args.limit ?? PARTD_SHORTLIST_LIMIT),
  };
}
