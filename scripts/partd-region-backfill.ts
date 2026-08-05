import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const plansPath = arg("plans");
  const contractYear = Number(arg("year") ?? "2026");
  if (!plansPath || !Number.isInteger(contractYear)) {
    throw new Error("Usage: tsx scripts/partd-region-backfill.ts --plans <ndjson> [--year YYYY]");
  }

  const regions = new Map<string, string>();
  const input = createInterface({ input: createReadStream(plansPath), crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    const plan = JSON.parse(line) as Record<string, unknown>;
    const contractId = String(plan.contract_id ?? "");
    const planId = String(plan.plan_id ?? "");
    const segmentId = String(plan.segment_id ?? "0");
    const region = String(plan.region ?? "").trim();
    if (!/^S\d{4}$/.test(contractId) || !/^\d{1,3}$/.test(planId) || !region) continue;
    regions.set(`${contractId}\t${planId}\t${segmentId}`, region);
  }

  let updated = 0;
  const entries = [...regions.entries()];
  for (let index = 0; index < entries.length; index += 100) {
    const batch = entries.slice(index, index + 100);
    const results = await prisma.$transaction(
      batch.map(([key, pdpRegionCode]) => {
        const [contractId, planId, segmentId] = key.split("\t");
        return prisma.partDPlan.updateMany({
          where: { contractId, planId, segmentId, contractYear },
          data: { pdpRegionCode },
        });
      }),
    );
    updated += results.reduce((total, result) => total + result.count, 0);
  }

  console.log(JSON.stringify({ contractYear, sourceRows: regions.size, updated }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
