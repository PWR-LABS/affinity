import { normalizedLedgerColumn } from './source-version';
/** Bounded transactional publication; optional managed retention preserves verified rollback generations. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { lineageSchema, validateTocLineage } from './toc-lineage';
import { ticSourceCurrent } from './freshness';

export const httpsUrl = z.string().url().refine(s => new URL(s).protocol === 'https:');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const member = z.object({
  npi: z.string().regex(/^\d{10}$/), tin_type: z.string().min(1), tin_value: z.string().min(1),
  file_url: httpsUrl, reporting_entity: z.string().min(1),
  last_updated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), schema: z.enum(['v1', 'v2']),
});
const plan = z.object({ planName: z.string(), planIdType: z.enum(['ein','hios']), planId: z.string().min(1), planMarketType: z.string() });
export const receiptSchema = z.object({
  version: z.literal(1), scope: z.literal('selected-file-only; plan completeness unverified'),
  sourceUrl: httpsUrl, tocUrl: httpsUrl,
  sourcePath: z.string(), sourceSha256: hash, tocPath: z.string(), tocSha256: hash,
  membershipPath: z.string(), membershipSha256: hash,
  membershipCount: z.number().int().positive().max(200_000),
  sourceDate: z.string(), reportingEntity: z.string().min(1), schema: z.enum(['v1','v2']),
  tocProjection: lineageSchema.optional(),
  plans: z.array(plan).min(1).max(30_000), preparedAt: z.string(),
});
export type TicPublication = z.infer<typeof receiptSchema>;
export async function sha256(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
export async function tocPlans(path: string, sourceUrl: string) {
  const bytes = await readFile(path);
  if (bytes.length > 10_000_000) throw new Error('TOC exceeds bounded refresh limit');
  const toc = JSON.parse((bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: 100_000_000 }) : bytes).toString());
  const plans = new Map<string, z.infer<typeof plan>>();
  for (const structure of toc.reporting_structure ?? []) {
    if (!structure.in_network_files?.some((f: { location: string }) => f.location === sourceUrl)) continue;
    for (const p of structure.reporting_plans ?? []) {
      const parsed = plan.parse({ planName: p.plan_name ?? '', planIdType: p.plan_id_type?.toLowerCase(), planId: p.plan_id, planMarketType: p.plan_market_type ?? '' });
      plans.set(JSON.stringify(parsed), parsed);
    }
  }
  if (!plans.size) throw new Error('Selected source has no plan mapping in the archived TOC');
  return [...plans.values()];
}
export async function* rows(path: string) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  try { for await (const line of lines) {
    if (!line.trim()) throw new Error('Blank membership record');
    yield member.parse(JSON.parse(line));
  } } finally { lines.close(); }
}
export async function validatePublication(input: unknown): Promise<TicPublication> {
  const r = receiptSchema.parse(input);
  if (!ticSourceCurrent(r.sourceDate, new Date().toISOString())) throw new Error('Source is stale, undated or future-dated');
  for (const [path, expected] of [[r.sourcePath, r.sourceSha256], [r.tocPath, r.tocSha256], [r.membershipPath, r.membershipSha256]]) {
    if (await sha256(path) !== expected) throw new Error('Publication hash mismatch');
  }
  if (r.tocProjection) await validateTocLineage(r.tocProjection,r.tocPath,r.tocSha256,r.sourceUrl);
  if (JSON.stringify(await tocPlans(r.tocPath, r.sourceUrl)) !== JSON.stringify(r.plans)) throw new Error('Plan mapping differs from archived TOC');
  let count = 0;
  for await (const row of rows(r.membershipPath)) {
    if (row.file_url !== r.sourceUrl || row.last_updated_on !== r.sourceDate || row.reporting_entity !== r.reportingEntity || row.schema !== r.schema) throw new Error('Mixed source metadata');
    count++;
  }
  if (count !== r.membershipCount) throw new Error('Membership count mismatch');
  return r;
}
export type ManagedPublication = {
  id: string; stableKey: string; contentHash: string; receiptPath: string;
  guard: () => void;
  retire: Array<{ id: string; fileId: string; contentHash: string }>;
};
export async function publishPublication(db: PrismaClient, input: unknown, managed?: ManagedPublication) {
  const r = await validatePublication(input);
  managed?.guard();
  return db.$transaction(async tx => {
    // Serialize publishers, not readers. The managed content ledger prevents duplicate generations.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(184937022)`;
    if (managed) {
      managed.guard();
      const prior = await tx.$queryRaw<Array<{fileId:string}>>`SELECT "fileId" FROM "TicRefreshPublication" WHERE id=${managed.id}`;
      if (prior.length) {
        const existing = await tx.ticFile.findUniqueOrThrow({where:{id:prior[0].fileId}});
        if (!existing.active) throw new Error('Publication is inactive; review required before reactivation');
        const memberships = await tx.ticMembership.count({where:{fileId:existing.id}});
        const plans = await tx.ticPlanLink.count({where:{fileId:existing.id}});
        if (memberships !== r.membershipCount || plans !== r.plans.length) throw new Error('Replay readback mismatch');
        return {fileId:existing.id,url:existing.url,sourceDate:r.sourceDate,memberships,plans,membershipSha256:r.membershipSha256,publishedAt:existing.fetchedAt.toISOString(),scope:r.scope,replayed:true};
      }
      const sizes = await tx.$queryRaw<Array<{bytes:bigint}>>`SELECT pg_database_size(current_database()) AS bytes`;
      // Reserve ample space on the existing 5 GB allocation, including staging/WAL/bloat.
      if (Number(sizes[0].bytes) + r.membershipCount * 1500 + r.plans.length * 2000 > 2_500_000_000) throw new Error('database_capacity_budget');
    }
    if (!managed && await tx.ticFile.findFirst({ where: { url: r.sourceUrl }, select: { id: true } })) throw new Error('Source already exists; no replacement or silent replay permitted');
    const file = await tx.ticFile.create({ data: { url: r.sourceUrl, reportingEntity: r.reportingEntity, sourceLastUpdated: new Date(r.sourceDate), schemaMode: r.schema, fetchedAt: new Date(r.preparedAt) } });
    let batch: { fileId: string; npi: string; tinType: string; tinValue: string }[] = [];
    let inserted = 0;
    const flush = async () => { managed?.guard(); if (batch.length) { inserted += (await tx.ticMembership.createMany({ data: batch })).count; batch = []; } };
    for await (const row of rows(r.membershipPath)) {
      if (row.file_url !== r.sourceUrl || row.last_updated_on !== r.sourceDate || row.reporting_entity !== r.reportingEntity || row.schema !== r.schema) throw new Error('Source changed during publication');
      batch.push({ fileId: file.id, npi: row.npi, tinType: row.tin_type, tinValue: row.tin_value });
      if (batch.length === 1000) await flush();
    }
    await flush();
    for (let i = 0; i < r.plans.length; i += 1000) await tx.ticPlanLink.createMany({ data: r.plans.slice(i, i + 1000).map(p => ({ ...p, fileId: file.id })) });
    if (inserted !== r.membershipCount || await sha256(r.membershipPath) !== r.membershipSha256) throw new Error('Publication changed or count mismatch');
    const counts = { memberships: await tx.ticMembership.count({ where: { fileId: file.id } }), plans: await tx.ticPlanLink.count({ where: { fileId: file.id } }) };
    if (counts.memberships !== r.membershipCount || counts.plans !== r.plans.length) throw new Error('Database readback mismatch');
    if (managed) {
      managed.guard();
      // Activate only this content version; retain prior bytes for rollback without
      // letting a superseded provider listing continue to answer current lookups.
      await tx.$executeRaw`UPDATE "TicFile" SET active=false WHERE id<>${file.id} AND (url=${r.sourceUrl} OR id IN (SELECT "fileId" FROM "TicRefreshPublication" WHERE ${normalizedLedgerColumn}=${managed.stableKey}))`;
      await tx.$executeRaw`INSERT INTO "TicRefreshPublication" (id,"stableKey","fileId","sourceDate","contentHash","receiptPath") VALUES (${managed.id},${managed.stableKey},${file.id},${r.sourceDate},${managed.contentHash},${managed.receiptPath})`;
      // Delete only generations this publisher owns and has independently archive-verified.
      for (const old of managed.retire) {
        const owned = await tx.$queryRaw<Array<{fileId:string}>>`SELECT "fileId" FROM "TicRefreshPublication" WHERE id=${old.id} AND "fileId"=${old.fileId} AND ${normalizedLedgerColumn}=${managed.stableKey} AND "contentHash"=${old.contentHash} AND "sourceDate" <= ${r.sourceDate} AND withdrawn=false`;
        if (owned.length !== 1) throw new Error('Retention ownership changed');
        const survivors = await tx.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM "TicRefreshPublication" WHERE ${normalizedLedgerColumn}=${managed.stableKey} AND withdrawn=false AND "createdAt" > (SELECT "createdAt" FROM "TicRefreshPublication" WHERE id=${old.id})`;
        if (Number(survivors[0].count) < 2) throw new Error('Retention requires current and rollback generations');
        await tx.ticFile.delete({where:{id:old.fileId}});
      }
      managed.guard();
    }
    return { fileId: file.id, url: r.sourceUrl, sourceDate: r.sourceDate, ...counts, membershipSha256: r.membershipSha256, publishedAt: new Date().toISOString(), scope: r.scope };
  }, { timeout: 180_000, maxWait: 10_000 });
}
