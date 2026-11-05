import { ticSourceWindow } from "@/lib/tic/freshness";
import { prisma } from "@/lib/prisma";

export interface CoverageReadiness {
  employer: boolean;
  partD: boolean;
}

/** Availability of recent listings, NOT certification of plan completeness. */
export async function employerIndexReady(db = prisma, now = new Date()): Promise<boolean> {
  const file = await db.ticFile.findFirst({
    where: {
      active: true,
      sourceLastUpdated: ticSourceWindow(now),
      OR: [{ memberships: { some: {} } }, { compactIndex: { is: { format: "npi-prefix-v1", npiCount: { gt: 0 } } } }],
      planLinks: { some: {} },
    },
    select: { id: true },
  });
  return Boolean(file);
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
