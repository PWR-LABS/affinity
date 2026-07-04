/**
 * tic-load — load the TiC ingest artifacts into the thin network-membership index (S4).
 *
 * Input: a manifest.csv (from tools/tic-ingest/toc-manifest) and a directory of extractor shards
 * (<shard>.ndjson + <shard>.done markers, from tools/tic-ingest/tic-extract). Only shards with a
 * .done marker are loaded. Idempotent: each file is upserted by URL and its memberships/plan links
 * are replaced wholesale, so re-running after a partial load or a fresh extract is safe.
 *
 * Usage: DATABASE_URL=... tsx scripts/tic-load.ts --manifest <manifest.csv> --shards <dir>
 */
import { createReadStream, existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

import { prisma } from "@/lib/prisma";
import { parseManifestLine, parseMembershipLine, type TicFilePlans } from "@/lib/tic/ingest";

const BATCH = 5000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set — start Postgres (npm run db:up) and export it first.");
  }
  const manifestPath = arg("manifest");
  const shardsDir = arg("shards");
  if (!manifestPath || !shardsDir || !existsSync(manifestPath) || !existsSync(shardsDir)) {
    throw new Error("Usage: tsx scripts/tic-load.ts --manifest <manifest.csv> --shards <dir-with-ndjson>");
  }

  // Manifest → file → plan links. Streamed + grouped incrementally: big issuers ship 800K+ rows with
  // ~400-char signed URLs, so materializing all rows (or URL-prefixed dedup keys) OOMs. Dedup is
  // per-file with short keys instead.
  const byFile = new Map<string, TicFilePlans & { seen: Set<string> }>();
  let manifestRows = 0;
  const manifestRl = createInterface({ input: createReadStream(manifestPath), crlfDelay: Infinity });
  for await (const line of manifestRl) {
    const r = parseManifestLine(line);
    if (!r) continue;
    manifestRows++;
    let entry = byFile.get(r.fileUrl);
    if (!entry) {
      entry = { reportingEntity: r.reportingEntity, plans: [], seen: new Set() };
      byFile.set(r.fileUrl, entry);
    }
    const key = `${r.planIdType}|${r.planId}|${r.planName}`;
    if (entry.seen.has(key)) continue;
    entry.seen.add(key);
    entry.plans.push({ planName: r.planName, planIdType: r.planIdType, planId: r.planId, planMarketType: r.planMarketType });
  }
  console.log(`manifest: ${manifestRows} rows → ${byFile.size} files`);

  const fetchedAt = new Date();
  const shards = readdirSync(shardsDir).filter((f) => f.endsWith(".ndjson"));
  let loadedFiles = 0;
  let totalMemberships = 0;
  let skippedNotDone = 0;
  let malformed = 0;

  for (const shard of shards) {
    const doneMarker = join(shardsDir, `${basename(shard, ".ndjson")}.done`);
    if (!existsSync(doneMarker)) {
      skippedNotDone++;
      continue;
    }

    // Stream the shard once to collect memberships + the file-level metadata on its lines.
    const memberships: Array<{ npi: string; tinType: string; tinValue: string }> = [];
    let fileUrl: string | undefined;
    let reportingEntity = "unknown";
    let lastUpdatedOn: string | undefined;
    let schemaMode: string | undefined;
    const rl = createInterface({ input: createReadStream(join(shardsDir, shard)), crlfDelay: Infinity });
    for await (const line of rl) {
      const m = parseMembershipLine(line);
      if (!m) {
        if (line.trim()) malformed++;
        continue;
      }
      fileUrl = m.fileUrl;
      reportingEntity = m.reportingEntity;
      lastUpdatedOn = m.lastUpdatedOn ?? lastUpdatedOn;
      schemaMode = m.schema ?? schemaMode;
      memberships.push({ npi: m.npi, tinType: m.tinType, tinValue: m.tinValue });
    }
    if (!fileUrl) {
      console.warn(`  ${shard}: empty/unparseable — skipped`);
      continue;
    }

    const planInfo = byFile.get(fileUrl);
    const file = await prisma.ticFile.upsert({
      where: { url: fileUrl },
      create: {
        url: fileUrl,
        reportingEntity: planInfo?.reportingEntity ?? reportingEntity,
        sourceLastUpdated: lastUpdatedOn ? new Date(lastUpdatedOn) : null,
        schemaMode,
        fetchedAt,
      },
      update: { sourceLastUpdated: lastUpdatedOn ? new Date(lastUpdatedOn) : null, schemaMode, fetchedAt },
    });

    // Replace wholesale for idempotency.
    await prisma.ticMembership.deleteMany({ where: { fileId: file.id } });
    for (let i = 0; i < memberships.length; i += BATCH) {
      await prisma.ticMembership.createMany({
        data: memberships.slice(i, i + BATCH).map((m) => ({ ...m, fileId: file.id })),
        skipDuplicates: true,
      });
    }
    await prisma.ticPlanLink.deleteMany({ where: { fileId: file.id } });
    if (planInfo) {
      await prisma.ticPlanLink.createMany({ data: planInfo.plans.map((p) => ({ ...p, fileId: file.id })) });
    }

    loadedFiles++;
    totalMemberships += memberships.length;
    console.log(`  ${shard}: ${memberships.length} memberships, ${planInfo?.plans.length ?? 0} plan links`);
  }

  const counts = {
    files: await prisma.ticFile.count(),
    memberships: await prisma.ticMembership.count(),
    planLinks: await prisma.ticPlanLink.count(),
  };
  console.log(
    `\nloaded ${loadedFiles} shard(s), ${totalMemberships} memberships (${skippedNotDone} shard(s) without .done skipped, ${malformed} malformed lines)`,
  );
  console.log(`index now: ${counts.files} files · ${counts.memberships} memberships · ${counts.planLinks} plan links`);
}

main()
  .catch((e) => {
    console.error("tic-load failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
