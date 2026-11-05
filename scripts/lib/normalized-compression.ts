/** macOS transparent compression preserves every logical byte and receipt path.
 * Stage a streamed system-ditto copy, verify it, then atomically replace only the
 * normalized file. Raw source archives and publication receipts are unchanged.
 */
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {lstat,realpath,readFile,readdir,mkdtemp,rename,unlink,rmdir,open} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {lstatSync,realpathSync,type BigIntStats} from 'node:fs';
import {sha256,validatePublication} from '../../src/lib/tic/publication';
import {durableJson} from '../../src/lib/tic/source-proof';
const active=new Set<string>();
const prefix='.normalized-compression-';
type Options={receiptPath:string;root:string;guard:()=>void;reserve:(bytes:number)=>Promise<void>;cleanupGuard?:()=>void;keyPath?:string;
 checkpoint?:(phase:string)=>void;copy?:(source:string,directory:string,guard:()=>void)=>Promise<void>};
function stable(a:BigIntStats,b:BigIntStats){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;}
async function syncDirectory(path:string){const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function ownedFile(path:string,device:bigint){const s=await lstat(path,{bigint:true});if(!s.isFile()||s.nlink!==BigInt(1)||s.uid!==BigInt(process.getuid!())||s.dev!==device||await realpath(path)!==path)throw Error('Unsafe normalized compression file');return s;}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code!=='ESRCH';}}
function noOpenFiles(directory:string){
 const result=spawnSync('/usr/sbin/lsof',['-t','+D',directory],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000});
 // macOS lsof +D can return status 1 AND matching PIDs. Output takes precedence.
 if(result.stdout?.trim()||result.status===0)throw Error('Normalized compression writer remains open');
 if(result.error||result.signal||result.status!==1||result.stderr?.trim())throw Error('Normalized compression open-handle check unavailable');
}
/** No shell, internal-volume staging or user-controlled archive is involved. */
async function copyCompressed(source:string,directory:string,guard:()=>void){
 const producer=spawn('/usr/bin/ditto',['-c',source,'-'],{stdio:['ignore','pipe','pipe']});
 const consumer=spawn('/usr/bin/ditto',['-x','--hfsCompression','-',directory],{stdio:['pipe','ignore','pipe']});
 producer.stderr.resume();consumer.stderr.resume();producer.stdout.pipe(consumer.stdin);
 consumer.stdin.on('error',()=>{});let failure:unknown;
 const stop=()=>{producer.kill('SIGTERM');consumer.kill('SIGTERM');};
 const timer=setInterval(()=>{try{guard();}catch(e){failure=e;stop();}},250);
 const deadline=setTimeout(()=>{failure=Error('Normalized compression copy deadline');stop();},10*60000);
 const wait=(child:ChildProcess)=>new Promise<void>((resolve,reject)=>{child.once('error',e=>{stop();reject(e);});child.once('close',code=>code===0?resolve():reject(Error('Normalized compression copy failed')));});
 try{const results=await Promise.allSettled([wait(producer),wait(consumer)]);if(failure)throw failure;const rejected=results.find(r=>r.status==='rejected');if(rejected?.status==='rejected')throw rejected.reason;guard();}
 finally{clearInterval(timer);clearTimeout(deadline);}
}
async function cleanStage(directory:string,source:string,device:bigint,guard:()=>void){
 guard();const dir=await lstat(directory,{bigint:true});
 if(!dir.isDirectory()||dir.uid!==BigInt(process.getuid!())||dir.dev!==device||await realpath(directory)!==directory||dirname(directory)!==dirname(source)||!basename(directory).startsWith(prefix))throw Error('Unsafe normalized compression stage');
 const journalPath=join(directory,'journal.json');await ownedFile(journalPath,device);
 const j=JSON.parse(await readFile(journalPath,'utf8'));
 if(j.version!==1||j.source!==source||j.directory!==directory||j.directoryInode!==String(dir.ino)||j.directoryDevice!==String(dir.dev)||j.candidate!==basename(source)||!Number.isSafeInteger(j.pid)||j.pid<1)throw Error('Normalized compression stage identity mismatch');
 if(j.pid!==process.pid&&alive(j.pid))throw Error('Normalized compression owner remains active');
 const names=await readdir(directory);if(names.some(n=>n!=='journal.json'&&n!==j.candidate))throw Error('Unrecognized normalized compression stage content');
 noOpenFiles(directory);
 if(names.includes(j.candidate)){const path=join(directory,j.candidate),before=await ownedFile(path,device);guard();if(!stable(before,await lstat(path,{bigint:true})))throw Error('Normalized compression stage changed');await unlink(path);}
 guard();await unlink(journalPath);await rmdir(directory);await syncDirectory(dirname(directory));
}
export async function compressNormalizedEvidence(options:Options){
 if(process.platform!=='darwin')return {state:'unsupported_platform' as const};
 const root=resolve(options.root),receiptPath=resolve(options.receiptPath);options.guard();
 if(!receiptPath.startsWith(root+'/')||await realpath(receiptPath)!==receiptPath)throw Error('Compression receipt outside archive');
 const receipt=await validatePublication(JSON.parse(await readFile(receiptPath,'utf8')),options.keyPath);
 const path=resolve(receipt.membershipPath),directory=dirname(path);
 if(!path.startsWith(root+'/')||directory!==dirname(receiptPath)||!/^(?:[a-f0-9]{64}|members)\.ndjson$/.test(basename(path)))throw Error('Compression membership outside owned source directory');
 if(active.has(path))throw Error('Normalized compression already active');active.add(path);
 let stage:string|undefined;
 try{
  const owner=await lstat(directory,{bigint:true});if(!owner.isDirectory()||owner.uid!==BigInt(process.getuid!())||await realpath(directory)!==directory)throw Error('Unsafe normalized compression directory');
  const checkOwner=()=>{const current=lstatSync(directory,{bigint:true});if(current.dev!==owner.dev||current.ino!==owner.ino||realpathSync(directory)!==directory)throw Error('Normalized source directory changed');};
  const guard=()=>{options.guard();checkOwner();};
  const cleanup=()=>{(options.cleanupGuard??options.guard)();checkOwner();};
  for(const name of await readdir(directory))if(name.startsWith(prefix)){
   await cleanStage(join(directory,name),path,owner.dev,cleanup);
   await durableJson(join(directory,'normalized-compression-recovery.json'),{state:'owned_stage_recovered',stage:name,sourceSha256:receipt.membershipSha256,currentReceiptVerified:true,observedAt:new Date().toISOString()});
  }
  const before=await ownedFile(path,owner.dev);
  // Already sparse/compressed or too small to justify another copy. This is an
  // optimization decision only; full receipt validation above remains required.
  if(before.size<BigInt(65536)||before.blocks*BigInt(512)<before.size*BigInt(8)/BigInt(10))return {state:'already_space_efficient' as const};
  await options.reserve(Number(before.size)+1_000_000);guard();stage=await mkdtemp(join(directory,prefix));const stageInfo=await lstat(stage,{bigint:true});
  await durableJson(join(stage,'journal.json'),{version:1,pid:process.pid,source:path,sourceSha256:receipt.membershipSha256,directory:stage,directoryInode:String(stageInfo.ino),directoryDevice:String(stageInfo.dev),candidate:basename(path),observedAt:new Date().toISOString()});
  await syncDirectory(directory);options.checkpoint?.('before_copy');
  await (options.copy??copyCompressed)(path,stage,guard);options.checkpoint?.('after_copy');
  const candidate=join(stage,basename(path)),copied=await ownedFile(candidate,owner.dev);
  if(copied.size!==before.size||copied.mode!==before.mode||copied.gid!==before.gid||await sha256(candidate)!==receipt.membershipSha256)throw Error('Normalized compression candidate bytes differ');
  if(!stable(before,await lstat(path,{bigint:true})))throw Error('Normalized source changed during compression');
  if(copied.blocks>=before.blocks){await cleanStage(stage,path,owner.dev,cleanup);stage=undefined;return {state:'no_space_saving' as const};}
  const output=await open(candidate,'r');try{await output.sync();}finally{await output.close();}
  guard();if(!stable(before,await lstat(path,{bigint:true})))throw Error('Normalized source changed before replacement');
  options.checkpoint?.('before_replace');guard();await rename(candidate,path);await syncDirectory(directory);options.checkpoint?.('after_replace');
  const installed=await ownedFile(path,owner.dev);
  if(!stable(copied,installed)&&!(copied.dev===installed.dev&&copied.ino===installed.ino&&copied.size===installed.size&&copied.mtimeNs===installed.mtimeNs))throw Error('Normalized compressed replacement changed');
  if(await sha256(path)!==receipt.membershipSha256)throw Error('Normalized compressed bytes changed');
  guard();const result={state:'compressed' as const,observedAt:new Date().toISOString(),membershipSha256:receipt.membershipSha256,logicalBytes:Number(before.size),beforeAllocatedBytes:Number(before.blocks)*512,afterAllocatedBytes:Number(installed.blocks)*512,receiptUnchanged:true,sourceRawChanged:false};
  await durableJson(join(directory,'normalized-compression.json'),result);options.checkpoint?.('after_record');
  await cleanStage(stage,path,owner.dev,cleanup);stage=undefined;return result;
 }catch(e){
  if(stage&&!(e&&typeof e==='object'&&'preserveStage' in e)){
   try{await cleanStage(stage,path,(await lstat(directory,{bigint:true})).dev,options.cleanupGuard??options.guard);stage=undefined;}catch{}
  }
  if(stage&&e&&typeof e==='object')Object.assign(e,{compressionCleanupPending:true,compressionStage:stage});throw e;
 }finally{active.delete(path);}
}
