/**
 * partd-load — load the SPEC-7 Part D artifacts into the formulary index.
 *
 * Input: partd-plans.ndjson + partd-formulary.ndjson (from tools/tic-ingest/partd-formulary). Streams
 * both, batched upserts, idempotent (wipe-and-reload per contract year). No pricing data touched.
 *
 * Usage: DATABASE_URL=... tsx scripts/partd-load.ts --plans <partd-plans.ndjson> --formulary <partd-formulary.ndjson> [--year 2026]
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

import { prisma } from "@/lib/prisma";

const BATCH = 5000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function* lines(path: string): AsyncGenerator<Record<string, unknown>> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      yield JSON.parse(t) as Record<string, unknown>;
    } catch {
      /* skip malformed */
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const plansPath = arg("plans");
  const formularyPath = arg("formulary");
  const year = Number(arg("year") ?? "2026");
  if (!plansPath || !formularyPath || !existsSync(plansPath) || !existsSync(formularyPath)) {
    throw new Error("Usage: tsx scripts/partd-load.ts --plans <ndjson> --formulary <ndjson> [--year YYYY]");
  }

  // Wipe this contract year for idempotency.
  await prisma.partDPlan.deleteMany({ where: { contractYear: year } });
  await prisma.partDFormularyDrug.deleteMany({ where: { contractYear: year } });

  let planCount = 0;
  let planBatch: Array<Record<string, unknown>> = [];
  const flushPlans = async () => {
    if (!planBatch.length) return;
    await prisma.partDPlan.createMany({
      data: planBatch.map((p) => ({
        contractId: String(p.contract_id ?? ""),
        planId: String(p.plan_id ?? ""),
        segmentId: String(p.segment_id ?? "0"),
        contractYear: num(p.contract_year) ?? year,
        planName: String(p.plan_name ?? ""),
        formularyId: String(p.formulary_id ?? ""),
        state: typeof p.state === "string" && p.state.trim() ? p.state.trim() : null,
      })),
      skipDuplicates: true,
    });
    planCount += planBatch.length;
    planBatch = [];
  };
  for await (const p of lines(plansPath)) {
    if (!p.contract_id || !p.plan_id || !p.formulary_id) continue;
    planBatch.push(p);
    if (planBatch.length >= BATCH) await flushPlans();
  }
  await flushPlans();

  let drugCount = 0;
  let drugBatch: Array<Record<string, unknown>> = [];
  const flushDrugs = async () => {
    if (!drugBatch.length) return;
    await prisma.partDFormularyDrug.createMany({
      data: drugBatch.map((d) => ({
        formularyId: String(d.formulary_id ?? ""),
        contractYear: num(d.contract_year) ?? year,
        rxcui: String(d.rxcui ?? ""),
        tier: num(d.tier),
        priorAuthorization: bool(d.prior_authorization),
        stepTherapy: bool(d.step_therapy),
        quantityLimit: bool(d.quantity_limit),
        quantityLimitAmount: num(d.quantity_limit_amount),
        quantityLimitDays: num(d.quantity_limit_days),
      })),
      skipDuplicates: true,
    });
    drugCount += drugBatch.length;
    drugBatch = [];
  };
  for await (const d of lines(formularyPath)) {
    if (!d.formulary_id || !d.rxcui) continue;
    drugBatch.push(d);
    if (drugBatch.length >= BATCH) await flushDrugs();
  }
  await flushDrugs();

  console.log(`loaded ${planCount} Part D plans, ${drugCount} formulary rows (year ${year})`);
  console.log(`index now: ${await prisma.partDPlan.count()} plans · ${await prisma.partDFormularyDrug.count()} formulary rows`);
}

main()
  .catch((e) => {
    console.error("partd-load failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
