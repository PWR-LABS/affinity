import {compactManifest} from '../../src/lib/tic/compact-archive';
/** Reclaim only verified raw/normalized bytes belonging to retired managed publications. */
import { readFile, realpath, unlink, lstat, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { receiptSchema, sha256 } from '../../src/lib/tic/publication';
export async function reclaimRetiredArchives(db:PrismaClient, retired:Array<{id:string;receiptPath:string}>, root:string, guard:()=>void){
 const retained=await db.$queryRaw<Array<{receiptPath:string}>>`SELECT "receiptPath" FROM "TicRefreshPublication"`;
 const protectedPaths=new Set<string>();
 for(const p of retained){
  guard();const r=receiptSchema.parse(JSON.parse(await readFile(p.receiptPath,'utf8')));
  for(const path of [r.sourcePath,r.membershipPath,r.tocPath])protectedPaths.add(resolve(path));
  if(r.serving){protectedPaths.add(resolve(r.serving.manifestPath));for(const b of (await compactManifest(r.serving)).buckets)protectedPaths.add(join(dirname(resolve(r.serving.manifestPath)),b.prefix+'.deflate'));}
 }
 const removed:string[]=[];
 for(const p of retired){
  guard();
  const exists=await db.$queryRaw<Array<{id:string}>>`SELECT id FROM "TicRefreshPublication" WHERE id=${p.id}`;
  if(exists.length)throw new Error('Archive retention still referenced in database');
  const receiptPath=resolve(p.receiptPath);
  if(!receiptPath.startsWith(resolve(root)+'/')||await realpath(receiptPath)!==receiptPath)throw new Error('Unsafe retired archive');
  const r=receiptSchema.parse(JSON.parse(await readFile(receiptPath,'utf8')));
  const entries=[];
  for(const [path,hash] of [...(r.sourceArchive?[]:[[r.sourcePath,r.sourceSha256]]),[r.membershipPath,r.membershipSha256]]){
   const target=resolve(path);
   if(protectedPaths.has(target)||target===resolve(r.tocPath))continue;
   if(dirname(target)!==dirname(receiptPath)||await realpath(target)!==target||!(await lstat(target)).isFile()||await sha256(target)!==hash)throw new Error('Unsafe or changed retired bytes');
   entries.push({path:target,sha256:hash});
  }
  if(r.serving){const manifest=await compactManifest(r.serving);const bucketRoot=dirname(resolve(r.serving.manifestPath));
   if(bucketRoot!==join(dirname(receiptPath),'npi-prefix-v1')||await realpath(bucketRoot)!==bucketRoot)throw new Error('Unsafe retired compact root');
   for(const b of manifest.buckets){const target=join(bucketRoot,b.prefix+'.deflate');if(protectedPaths.has(target))continue;if(await realpath(target)!==target||!(await lstat(target)).isFile()||await sha256(target)!==b.payloadSha256)throw new Error('Retired compact bytes changed');entries.push({path:target,sha256:b.payloadSha256});}
  }
  // Keep receipt, TOC and a deletion manifest. No directory, legacy archive or
  // shared parent TOC is removed. Interrupted cleanup is reviewable and fails closed.
  guard();await writeFile(join(dirname(receiptPath),'retention.json'),JSON.stringify({version:1,publication:p.id,reason:'retired managed generation; current and rollback remain in DB',entries,observedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
  for(const entry of entries){guard();await unlink(entry.path);removed.push(entry.path);}
 }
 return {removedFiles:removed.length};
}
