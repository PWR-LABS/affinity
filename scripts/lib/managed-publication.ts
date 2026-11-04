import { createHash } from 'node:crypto';
import { sourceIdentity } from './issuer-discovery';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { receiptSchema, sha256, publishPublication, type TicPublication } from '../../src/lib/tic/publication';
export function logicalKey(url: string) {
  return sourceIdentity(url).replace(/\d{4}-\d{2}-\d{2}/g, '{date}');
}
export function fingerprint(r: TicPublication) {
  return createHash('sha256').update(JSON.stringify([r.sourceSha256,r.sourceDate,r.reportingEntity,r.schema,r.plans.map(p=>[p.planName,p.planIdType,p.planId,p.planMarketType]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])).digest('hex');
}
export async function publishManaged(db: PrismaClient, r: TicPublication, receiptPath: string, guard:()=>void, root: string) {
  const stableKey = logicalKey(r.sourceUrl), contentHash = fingerprint(r);
  const id = createHash('sha256').update(stableKey + '\n' + contentHash).digest('hex');
  const previous = await db.$queryRaw<Array<{id:string;fileId:string;contentHash:string;receiptPath:string;sourceDate:string}>>`SELECT * FROM "TicRefreshPublication" WHERE "stableKey"=${stableKey} ORDER BY "sourceDate" DESC, "createdAt" DESC`;
  const newer = previous.filter(p => p.sourceDate > r.sourceDate);
  if (newer.length) throw new Error('Source date regression');
  if (previous.some(p=>p.sourceDate === r.sourceDate && p.id !== id)) throw new Error('Same-date content changed; review required');
  const retire = previous.filter(p=>p.sourceDate < r.sourceDate).slice(1);
  for (const p of retire) {
    guard();
    if (!resolve(p.receiptPath).startsWith(resolve(root) + '/')) throw new Error('Retention archive outside approved root');
    const old = receiptSchema.parse(JSON.parse(await readFile(p.receiptPath,'utf8')));
    if (fingerprint(old) !== p.contentHash) throw new Error('Retention receipt mismatch');
    // A historical archive is expected to be stale. Validate bytes, not today's freshness.
    for (const [path,hash] of [[old.sourcePath,old.sourceSha256],[old.tocPath,old.tocSha256],[old.membershipPath,old.membershipSha256]]) {
      if (!resolve(path).startsWith(resolve(root) + '/') || await sha256(path) !== hash) throw new Error('Retention archive unavailable');
    }
  }
  return publishPublication(db,r,{id,stableKey,contentHash,receiptPath,guard,retire});
}
