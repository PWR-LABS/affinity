import { normalizeLedgerKey, normalizedLedgerColumn } from '../../src/lib/tic/source-version';
import { reclaimRetiredArchives } from './archive-retention';
import { createHash } from 'node:crypto';
import { sourceIdentity } from './issuer-discovery';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { receiptSchema, sha256, publishPublication, type TicPublication } from '../../src/lib/tic/publication';
export function logicalKey(url: string) {
  return normalizeLedgerKey(sourceIdentity(url));
}
export function planMappingIdentity(plans:TicPublication['plans']){return JSON.stringify(plans.map(p=>[p.planName,p.planIdType,p.planId,p.planMarketType]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}
export function fingerprint(r: TicPublication) {
  return createHash('sha256').update(JSON.stringify([r.sourceSha256,r.sourceDate,r.reportingEntity,r.schema,r.plans.map(p=>[p.planName,p.planIdType,p.planId,p.planMarketType]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])).digest('hex');
}
/** Callers must separately validate both receipts and establish that the prior is active. */
export function sameManagedContent(candidate:TicPublication,active:TicPublication|undefined){
 return Boolean(active&&logicalKey(candidate.sourceUrl)===logicalKey(active.sourceUrl)&&fingerprint(candidate)===fingerprint(active));
}
export async function publishManaged(db: PrismaClient, r: TicPublication, receiptPath: string, guard:()=>void, root: string) {
  const stableKey = logicalKey(r.sourceUrl), contentHash = fingerprint(r);
  let id = createHash('sha256').update(stableKey + '\n' + contentHash).digest('hex');
  const previous = await db.$queryRaw<Array<{id:string;fileId:string;contentHash:string;receiptPath:string;sourceDate:string}>>`SELECT * FROM "TicRefreshPublication" WHERE ${normalizedLedgerColumn}=${stableKey} AND withdrawn=false ORDER BY "sourceDate" DESC, "createdAt" DESC`;
  id=previous.find(p=>p.contentHash===contentHash)?.id??id;
  const newer = previous.filter(p => p.sourceDate > r.sourceDate);
  if (newer.length) throw new Error('Source date regression');
  const retire = previous.filter(p=>p.id !== id).slice(1);
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
  const result=await publishPublication(db,r,{id,stableKey,contentHash,receiptPath,guard,retire});
  if(!retire.length)return result;
  try {return {...result,archiveRetention:await reclaimRetiredArchives(db,retire,root,guard)};}
  catch {return {...result,archiveRetention:{state:'deferred',reason:'Retired archive cleanup requires review; database commit verified'}};}
}

/** Explicit recovery: withdraw the exact active managed file and reactivate its predecessor. */
export async function withdrawManaged(db: PrismaClient, fileId: string, guard:()=>void) {
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(184937022)`;guard();
  const current=await tx.$queryRaw<Array<{stableKey:string}>>`SELECT p."stableKey" FROM "TicRefreshPublication" p JOIN "TicFile" f ON f.id=p."fileId" WHERE p."fileId"=${fileId} AND f.active=true AND p.withdrawn=false`;
  if(current.length!==1)throw new Error('Withdrawal target is not active managed data');
  const prior=await tx.$queryRaw<Array<{fileId:string}>>`SELECT "fileId" FROM "TicRefreshPublication" WHERE ${normalizedLedgerColumn}=${normalizeLedgerKey(current[0].stableKey)} AND "fileId"<>${fileId} AND withdrawn=false ORDER BY "sourceDate" DESC,"createdAt" DESC LIMIT 1`;
  if(prior.length!==1)throw new Error('No retained rollback generation');
  if(!await tx.ticMembership.count({where:{fileId:prior[0].fileId}})||!await tx.ticPlanLink.count({where:{fileId:prior[0].fileId}}))throw new Error('Rollback generation incomplete');
  await tx.$executeRaw`UPDATE "TicRefreshPublication" SET withdrawn=true WHERE "fileId"=${fileId}`;
  await tx.ticFile.update({where:{id:fileId},data:{active:false}});
  await tx.ticFile.update({where:{id:prior[0].fileId},data:{active:true}});
  guard();return {withdrawn:fileId,active:prior[0].fileId};
 },{timeout:30000});
}
