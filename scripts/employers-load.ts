/**
 * employers-load — load SPEC-4 DOL Form 5500 employer-name → EIN rows.
 *
 * Input: employers.ndjson from tools/tic-ingest/dol5500-employers.ts.
 * Wipe-and-reload semantics keep the lookup table aligned with the latest public DOL snapshot.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

import { prisma } from "@/lib/prisma";
import { parseEmployerEinLine } from "@/lib/tic/ingest";

const BATCH = 5000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function flush(batch: Array<NonNullable<ReturnType<typeof parseEmployerEinLine>>>): Promise<number> {
  if (batch.length === 0) return 0;
  const result = await prisma.employerEin.createMany({
    data: batch.map((row) => ({
      ein: row.ein,
      name: row.name,
      nameNorm: row.nameNorm,
      state: row.state,
      planName: row.planName,
      participants: row.participants,
      planYear: row.planYear,
    })),
    skipDuplicates: true,
  });
  batch.length = 0;
  return result.count;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — start Postgres (npm run db:up) and export it first.");
  }
  const input = arg("in");
  if (!input || !existsSync(input)) {
    throw new Error("Usage: tsx scripts/employers-load.ts --in <employers.ndjson>");
  }

  const deleted = await prisma.employerEin.deleteMany();
  console.log(`cleared ${deleted.count} employer row(s)`);

  const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const batch: Array<NonNullable<ReturnType<typeof parseEmployerEinLine>>> = [];
  let scanned = 0;
  let malformed = 0;
  let inserted = 0;

  for await (const line of rl) {
    scanned += 1;
    const parsed = parseEmployerEinLine(line);
    if (!parsed) {
      if (line.trim()) malformed += 1;
      continue;
    }
    batch.push(parsed);
    if (batch.length >= BATCH) inserted += await flush(batch);
  }
  inserted += await flush(batch);

  console.log(`loaded ${inserted} employer row(s) from ${scanned} line(s); malformed=${malformed}`);
}

main()
  .catch((e) => {
    console.error("employers-load failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
