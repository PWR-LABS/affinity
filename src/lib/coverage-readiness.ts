import { prisma } from "@/lib/prisma";

export interface CoverageReadiness {
  employer: boolean;
  partD: boolean;
}

async function employerIndexReady(): Promise<boolean> {
  const [membership, plan] = await Promise.all([
    prisma.ticMembership.findFirst({ select: { id: true } }),
    prisma.ticPlanLink.findFirst({ select: { id: true } }),
  ]);
  return Boolean(membership && plan);
}

async function partDIndexReady(): Promise<boolean> {
  const [drug, plan] = await Promise.all([
    prisma.partDFormularyDrug.findFirst({ select: { id: true } }),
    prisma.partDPlan.findFirst({ select: { id: true } }),
  ]);
  return Boolean(drug && plan);
}

/**
 * A verifier is available only when both sides of its lookup join hold data.
 * Missing configuration, migrations, or source data all fail closed.
 */
export async function getCoverageReadiness(): Promise<CoverageReadiness> {
  if (!process.env.DATABASE_URL) return { employer: false, partD: false };

  const [employer, partD] = await Promise.all([
    employerIndexReady().catch(() => false),
    partDIndexReady().catch(() => false),
  ]);
  return { employer, partD };
}
