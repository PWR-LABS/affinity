import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,realpath,mkdir,open,rename,unlink,readdir,readFile,type FileHandle} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {z} from 'zod';
import {durableJson,syncDirectory} from '../../src/lib/tic/source-proof';
import {sourceIdentity} from './issuer-discovery';

export type DownloadJournal={directory:string;archiveRoot:string;volumeUUID:string};
const recordSchema=z.object({version:z.literal(1),id:z.string().uuid(),pid:z.number().int().positive(),phase:z.enum(['downloading','interrupted']),volumeUUID:z.string(),finalPath:z.string(),parentIno:z.string(),fileIno:z.string(),uid:z.number().int(),maxBytes:z.number().int().positive(),completedBytes:z.number().int().nonnegative(),completedSha256:z.string().regex(/^[a-f0-9]{64}$/),source:z.string()});
const receiptSchema=z.object({bytes:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),etag:z.string().nullable(),lastModified:z.string().nullable()});
const completedSchema=recordSchema.pick({version:true,volumeUUID:true,finalPath:true,parentIno:true,fileIno:true,uid:true,source:true}).extend({receipt:receiptSchema,observedAt:z.string().datetime()});
const completedPath=(journal:DownloadJournal,path:string)=>join(journal.directory,'complete',createHash('sha256').update(path).digest('hex')+'.json');
async function privateDirectory(path:string){
 await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);
 if(!s.isDirectory()||(s.mode&0o077)||s.uid!==process.getuid?.()||await realpath(path)!==resolve(path))throw new Error('Unsafe download journal');
}
function stamp(s:Awaited<ReturnType<typeof lstat>>){return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');}
async function absent(path:string){try{await lstat(path);return false;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return true;throw e;}}

/** Write-once staged downloads. Only hashes and ownership metadata enter the
 * internal journal; source bytes remain in the caller's archive directory. */
export async function downloadOwnedFile(args:{url:string;path:string;maxBytes:number;guard:()=>void;fetcher?:typeof fetch;timeoutMs:number;journal?:DownloadJournal;fault?:(phase:'download_recorded'|'promoted')=>void|Promise<void>}){
 const {url,maxBytes,guard,journal}=args,u=new URL(url),path=resolve(args.path),parent=dirname(path);
 if(u.protocol!=='https:'||u.username||u.password)throw new Error('HTTPS source required');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<=0)throw new Error('Invalid download cap');
 guard();const parentStat=await lstat(parent);
 if(!parentStat.isDirectory()||await realpath(parent)!==parent||!await absent(path))throw new Error('Unsafe or occupied download target');
 if(journal){if(!path.startsWith(resolve(journal.archiveRoot)+'/'))throw new Error('Download outside journal archive');await privateDirectory(journal.directory);}
 const check=async()=>{guard();const s=await lstat(parent);if(s.dev!==parentStat.dev||s.ino!==parentStat.ino||await realpath(parent)!==parent)throw new Error('Download directory changed');};
 const response=await (args.fetcher??fetch)(url,{signal:AbortSignal.timeout(args.timeoutMs),redirect:'error',headers:{'Accept-Encoding':'identity'}});
 if(!response.ok||!response.body){await response.body?.cancel();throw new Error(`Source HTTP ${response.status}`);}
 if(Number(response.headers.get('content-length'))>maxBytes){await response.body.cancel();throw new Error('source_size_limit');}
 const id=randomUUID(),partial=path+'.'+id+'.partial',journalPath=journal?join(journal.directory,id+'.json'):undefined;
 let file:FileHandle|undefined,fileStat:Awaited<ReturnType<typeof lstat>>|undefined,record:z.infer<typeof recordSchema>|undefined,registered=false,promoted=false,bytes=0,lastCheckpoint=0;
 const hash=createHash('sha256');
 try{
  await check();file=await open(partial,'wx',0o600);fileStat=await file.stat();
  record={version:1,id,pid:process.pid,phase:'downloading',volumeUUID:journal?.volumeUUID??'',finalPath:path,parentIno:String(parentStat.ino),fileIno:String(fileStat.ino),uid:fileStat.uid,maxBytes,completedBytes:0,completedSha256:hash.copy().digest('hex'),source:sourceIdentity(url)};
  if(journalPath){await durableJson(journalPath,record);registered=true;}
  const reader=response.body.getReader();
  try{while(true){const next=await reader.read();if(next.done)break;await check();if(bytes+next.value.length>maxBytes)throw new Error('source_size_limit');await file.writeFile(next.value);bytes+=next.value.length;hash.update(next.value);
   if(journalPath&&bytes-lastCheckpoint>=16_000_000){await file.sync();record.completedBytes=bytes;record.completedSha256=hash.copy().digest('hex');await durableJson(journalPath,record);lastCheckpoint=bytes;}
  }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!bytes)throw new Error('empty_source');const expected=Number(response.headers.get('content-length'));
  if(expected&&!response.headers.get('content-encoding')&&bytes!==expected)throw new Error('source_length_mismatch');
  await file.sync();await file.close();file=undefined;await check();
  const named=await lstat(partial);if(!named.isFile()||named.dev!==fileStat.dev||named.ino!==fileStat.ino||named.size!==bytes||await realpath(partial)!==partial||!await absent(path))throw new Error('Download target changed');
  const receipt={bytes,sha256:hash.copy().digest('hex'),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
  if(journal){await privateDirectory(join(journal.directory,'complete'));await durableJson(completedPath(journal,path),completedSchema.parse({...record,receipt,observedAt:new Date().toISOString()}));}
  await args.fault?.('download_recorded');
  await check();if(stamp(named)!==stamp(await lstat(partial))||!await absent(path))throw new Error('Download stage changed before activation');
  await rename(partial,path);promoted=true;await syncDirectory(parent);
  await args.fault?.('promoted');
  if(journalPath)await unlink(journalPath);
  return receipt;
 }catch(error){
  await file?.close().catch(()=>{});file=undefined;
  // Keep the last fsynced prefix; bytes from an interrupted write need not have
  // reached the detached device and must not become a false recovery invariant.
  if(registered&&record&&journalPath){record.phase='interrupted';await durableJson(journalPath,record).catch(()=>{});}
  try{
   if(!promoted&&fileStat){await check();const s=await lstat(partial);if(!s.isFile()||s.dev!==fileStat.dev||s.ino!==fileStat.ino||await realpath(partial)!==partial)throw new Error('Download stage changed');await unlink(partial);await syncDirectory(parent);}
   if(registered&&journalPath)await unlink(journalPath);
  }catch{if(error instanceof Error)Object.assign(error,{downloadCleanupPending:true,downloadJournalPath:journalPath,partialPath:partial});}
  throw error;
 }finally{await file?.close().catch(()=>{});if(!response.body.locked)await response.body.cancel().catch(()=>{});}
}

/** Recover a completed download after a lost caller receipt. The caller must
 * supply a freshly verified source validator and length; full JSON/archive
 * validation remains a separate requirement before accepting issuer evidence. */
export async function recoverCompletedDownload(args:{journal:DownloadJournal;path:string;url:string;etag:string|null;bytes:number;guard:()=>void}){
 const {journal,guard}=args,path=resolve(args.path);guard();
 if(!args.etag||await absent(path))return;
 const marker=completedPath(journal,path);if(await absent(marker))return;
 const s=await lstat(marker);if(!s.isFile()||(s.mode&0o077)||s.uid!==process.getuid?.()||s.size>8192||await realpath(marker)!==marker)throw new Error('Unsafe completed download record');
 const record=completedSchema.parse(JSON.parse(await readFile(marker,'utf8')));
 if(record.finalPath!==path||!path.startsWith(resolve(journal.archiveRoot)+'/')||record.volumeUUID!==journal.volumeUUID||record.uid!==process.getuid?.()||record.source!==sourceIdentity(args.url)||record.receipt.etag!==args.etag||record.receipt.bytes!==args.bytes)return;
 const parent=await lstat(dirname(path)),before=await lstat(path);if(!parent.isDirectory()||String(parent.ino)!==record.parentIno||await realpath(dirname(path))!==dirname(path)||!before.isFile()||String(before.ino)!==record.fileIno||before.size!==args.bytes||await realpath(path)!==path)throw new Error('Completed download identity changed');
 const hash=createHash('sha256');for await(const chunk of createReadStream(path)){guard();hash.update(chunk);}
 guard();if(hash.digest('hex')!==record.receipt.sha256||stamp(before)!==stamp(await lstat(path)))throw new Error('Completed download bytes changed');
 return record.receipt;
}

/** Called only under the publisher lock after the exact volume UUID is checked.
 * A prior writer's durable prefix hash, directory and file identity must agree.
 * Final files, unjournaled partials, replaced paths and active writers stay intact. */
export async function recoverDownloadStages(journal:DownloadJournal,guard:()=>void){
 guard();if(await absent(journal.directory))return {recovered:0,active:0};await privateDirectory(journal.directory);
 const names=(await readdir(journal.directory)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));if(names.length>1000)throw new Error('Download recovery backlog requires review');
 let recovered=0,active=0;
 for(const name of names){
  guard();const path=join(journal.directory,name),s=await lstat(path);if(!s.isFile()||s.size>8192||(s.mode&0o077)||s.uid!==process.getuid?.()||await realpath(path)!==path)throw new Error('Unsafe download ownership record');
  const record=recordSchema.parse(JSON.parse(await readFile(path,'utf8')));
  if(name!==record.id+'.json'||record.volumeUUID!==journal.volumeUUID||record.uid!==process.getuid?.()||resolve(record.finalPath)!==record.finalPath||!record.finalPath.startsWith(resolve(journal.archiveRoot)+'/'))throw new Error('Download ownership mismatch');
  if(record.phase==='downloading'){let alive=true;try{process.kill(record.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')alive=false;else throw e;}if(alive){active++;continue;}}
  const partial=record.finalPath+'.'+record.id+'.partial',parent=dirname(partial),owner=await lstat(parent);
  if(!owner.isDirectory()||String(owner.ino)!==record.parentIno||await realpath(parent)!==parent)throw new Error('Download recovery directory changed');
  const reports=join(journal.directory,'recovered');await privateDirectory(reports);const reportPath=join(reports,name);
  if(await absent(partial)){if(await absent(reportPath))await durableJson(reportPath,{...record,state:'partial_absent',finalFilePreserved:true,observedAt:new Date().toISOString()});await unlink(path);recovered++;continue;}
  const before=await lstat(partial);if(!before.isFile()||String(before.ino)!==record.fileIno||before.uid!==record.uid||before.size<record.completedBytes||before.size>record.maxBytes||await realpath(partial)!==partial)throw new Error('Download recovery file changed');
  const full=createHash('sha256'),prefix=createHash('sha256');let seen=0;
  for await(const chunk of createReadStream(partial)){guard();const b=chunk as Buffer;full.update(b);if(seen<record.completedBytes)prefix.update(b.subarray(0,Math.min(b.length,record.completedBytes-seen)));seen+=b.length;}
  const sha256=full.digest('hex');if(prefix.digest('hex')!==record.completedSha256||stamp(before)!==stamp(await lstat(partial)))throw new Error('Download recovery bytes changed');
  if(!await absent(reportPath)){const prior=JSON.parse(await readFile(reportPath,'utf8'));if(prior.sha256!==sha256)throw new Error('Previously recorded partial changed');}
  const report={...record,state:'verified_before_removal',partialPath:partial,bytes:before.size,sha256,finalFilePreserved:true,observedAt:new Date().toISOString()};await durableJson(reportPath,report);
  guard();const currentParent=await lstat(parent);if(currentParent.dev!==owner.dev||currentParent.ino!==owner.ino||await realpath(parent)!==parent||stamp(before)!==stamp(await lstat(partial)))throw new Error('Download recovery target changed');
  await unlink(partial);await syncDirectory(parent);await durableJson(reportPath,{...report,state:'partial_removed',removedAt:new Date().toISOString()});await unlink(path);recovered++;
 }
 return {recovered,active};
}
