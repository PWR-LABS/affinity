import {compactManifest} from '../../src/lib/tic/compact-archive';
import {readFile,lstat,realpath,unlink} from 'node:fs/promises';
import {lstatSync,realpathSync,type BigIntStats} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import type {PrismaClient} from '@prisma/client';
import {receiptSchema,sha256,validatePublication,type TicPublication} from '../../src/lib/tic/publication';
import {durableJson,sealSourceProof,syncDirectory,extractionAcceptanceSchema} from '../../src/lib/tic/source-proof';
type Options={receiptPath:string;ownedRunRoot:string;guard:()=>void;retainedReceiptPaths:string[];keyPath?:string;afterSeal?:()=>void|Promise<void>;fault?:(phase:'proof_durable'|'receipt_durable'|'removal_manifest_durable'|'raw_removed')=>void|Promise<void>};
function stamp(s:BigIntStats){return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}
/** Only newly owned per-run source copies are eligible. Baseline archives, TOCs,
 * normalized rollback rows and all other retained raw references remain intact. */
export async function compactSourceArchive(options:Options){
 const path=resolve(options.receiptPath),dir=dirname(path),root=resolve(options.ownedRunRoot);
 options.guard();if(!path.startsWith(root+'/')||await realpath(path)!==path||await realpath(root)!==root)throw new Error('Compaction receipt outside owned run');
 const owners=[root,dir].map(p=>({path:p,stat:lstatSync(p,{bigint:true})}));
 const guard=()=>{options.guard();for(const owner of owners){const s=lstatSync(owner.path,{bigint:true});if(s.dev!==owner.stat.dev||s.ino!==owner.stat.ino||realpathSync(owner.path)!==owner.path)throw new Error('Compaction owned root changed');}};
 const receipt=receiptSchema.parse(JSON.parse(await readFile(path,'utf8')));
 const source=resolve(receipt.sourcePath);
 if(dirname(source)!==dir||dirname(resolve(receipt.membershipPath))!==dir||source!==join(dir,'source.json.gz'))throw new Error('Compaction source is not an owned per-run download');
 await validatePublication(receipt,options.keyPath);guard();
 let before;
 try{before=await lstat(source,{bigint:true});}catch(e){if(receipt.sourceArchive&&(e as NodeJS.ErrnoException).code==='ENOENT')return {state:'already_compacted',receipt,rawLogicalBytesRemoved:0};throw e;}
 if(!before.isFile()||await realpath(source)!==source)throw new Error('Unsafe compaction source');
 const download=JSON.parse(await readFile(join(dir,'download.json'),'utf8'));
 if(download.sha256!==receipt.sourceSha256||download.bytes!==Number(before.size)||await sha256(source)!==receipt.sourceSha256)throw new Error('Compaction download changed');
 const extraction=extractionAcceptanceSchema.parse(JSON.parse(await readFile(join(dir,'extraction.json'),'utf8')));
 if(extraction.sourceSha256!==receipt.sourceSha256||extraction.sourceBytes!==Number(before.size)||extraction.membershipSha256!==receipt.membershipSha256||extraction.tocSha256!==receipt.tocSha256||extraction.pairs_emitted!==receipt.membershipCount||extraction.schema!==receipt.schema)throw new Error('Compaction extraction acceptance mismatch');
 for(const retainedPath of options.retainedReceiptPaths){
  guard();if(resolve(retainedPath)===path)continue;
  const other=receiptSchema.parse(JSON.parse(await readFile(retainedPath,'utf8')));
  if(resolve(other.sourcePath)===source)return {state:'retained_shared_raw',receipt,rawLogicalBytesRemoved:0};
 }
 guard();
 const servingPaths=receipt.serving?[receipt.serving.manifestPath,...(await compactManifest(receipt.serving)).buckets.map(b=>join(dirname(receipt.serving!.manifestPath),b.prefix+'.deflate'))]:[];
 // Retained evidence must reach durable storage before a raw file can disappear.
 for(const retained of [...servingPaths,receipt.membershipPath,receipt.tocPath,path,join(dir,'extraction.json'),...(receipt.tocProjection?[receipt.tocProjection.parentPath,receipt.tocProjection.receiptPath]:[])]){guard();const f=await (await import('node:fs/promises')).open(retained,'r');try{await f.sync();}finally{await f.close();}}
 await syncDirectory(dirname(receipt.membershipPath));await syncDirectory(dirname(receipt.tocPath));
 const compacted:TicPublication=receipt.sourceArchive?receipt:{...receipt,sourceArchive:await sealSourceProof(receipt,extraction,join(dir,'source-compaction.json'),options.keyPath)};
 await options.fault?.('proof_durable');guard();await durableJson(path,compacted);await options.fault?.('receipt_durable');
 // Simulates a crash after durable replacement, before raw removal. Reentry must
 // validate the seal and the actual remaining raw bytes before deleting anything.
 await options.afterSeal?.();guard();
 await validatePublication(compacted,options.keyPath);guard();
 const manifest={version:1,state:'verified_before_removal',source,sourceSha256:receipt.sourceSha256,sourceBytes:Number(before.size),retainedMembership:receipt.membershipPath,retainedToc:receipt.tocPath,proof:compacted.sourceArchive,observedAt:new Date().toISOString()};
 await durableJson(join(dir,'source-retention.json'),manifest);await options.fault?.('removal_manifest_durable');guard();
 if(stamp(await lstat(source,{bigint:true}))!==stamp(before))throw new Error('Compaction source changed before removal');
 await unlink(source);await syncDirectory(dir);await options.fault?.('raw_removed');
 guard();await durableJson(join(dir,'source-retention.json'),{...manifest,state:'raw_removed',removedAt:new Date().toISOString()});
 return {state:'compacted',receipt:compacted,rawLogicalBytesRemoved:Number(before.size)};
}
export async function compactManagedSource(db:PrismaClient,receiptPath:string,ownedRunRoot:string,guard:()=>void,preparedReceiptPaths:string[]=[]){
 guard();const retained=await db.$queryRaw<Array<{receiptPath:string}>>`SELECT "receiptPath" FROM "TicRefreshPublication"`;
 return compactSourceArchive({receiptPath,ownedRunRoot,guard,retainedReceiptPaths:[...retained.map(r=>r.receiptPath),...preparedReceiptPaths]});
}
