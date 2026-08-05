export interface PartDPlanSelection {
  contractId: string;
  planId: string;
  segmentId: string;
  contractYear: number;
  planName: string;
  state?: string | null;
}

export interface PartDDrugSelection {
  rxcui: string;
  label: string;
}

export const MAX_PARTD_DRUGS = 20;

export function addPartDDrugSelection(
  current: PartDDrugSelection[],
  candidate: PartDDrugSelection,
): PartDDrugSelection[] {
  const rxcui = candidate.rxcui.trim();
  const label = candidate.label.trim();
  if (!/^\d{1,8}$/.test(rxcui) || !label || current.length >= MAX_PARTD_DRUGS) return current;
  if (current.some((drug) => drug.rxcui === rxcui)) return current;
  return [...current, { rxcui, label }];
}

export function encodePartDPlanSelection(plan: PartDPlanSelection): string {
  return JSON.stringify(plan);
}

export function decodePartDPlanSelection(value: string): PartDPlanSelection | null {
  try {
    const plan = JSON.parse(value) as Partial<PartDPlanSelection>;
    if (
      typeof plan.contractId !== "string" ||
      !/^[A-Z]\d{4}$/.test(plan.contractId) ||
      typeof plan.planId !== "string" ||
      !/^\d{1,3}$/.test(plan.planId) ||
      typeof plan.segmentId !== "string" ||
      !/^\d{1,3}$/.test(plan.segmentId) ||
      !Number.isInteger(plan.contractYear) ||
      typeof plan.contractYear !== "number" ||
      typeof plan.planName !== "string" ||
      !plan.planName.trim()
    ) {
      return null;
    }

    return {
      contractId: plan.contractId,
      planId: plan.planId,
      segmentId: plan.segmentId,
      contractYear: plan.contractYear,
      planName: plan.planName,
      state: typeof plan.state === "string" ? plan.state : null,
    };
  } catch {
    return null;
  }
}
