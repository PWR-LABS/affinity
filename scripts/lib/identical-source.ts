/** Transfer strict acceptance only across a full SHA-256 match to authenticated
 * source bytes. URL/plan identities stay separate and normalized rows are rebuilt.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,type BigIntStats} from 'node:fs';
import {readFile,lstat,realpath,open,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCompactArchive} from '../../src/lib/tic/compact-archive';
import {receiptSchema,validatePublication,sha256,rows,tocPlans,httpsUrl,type TicPublication} from '../../src/lib/tic/publication';
import {verifySourceProof,publicationDigest,durableJson,extractionAcceptanceSchema} from '../../src/lib/tic/source-proof';
const transformRevision=createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(process.version).digest('hex');
function same(a:BigIntStats,b:BigIntStats){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;}
/** Availability only. Cryptographic and full-content checks still run on reuse.
 * Retention can leave an old receipt after reclaiming its normalized bytes.
 */
export async function availableIdenticalReceipt(path:unknown,root:string):Promise<string|undefined>{
 const prefix=resolve(root)+'/';
 if(typeof path!=='string'||!resolve(path).startsWith(prefix))throw new Error('Identical-source cache outside archive');
 try{
  if(await realpath(path)!==resolve(path))throw new Error('Identical-source cache path changed');
  const prior=receiptSchema.parse(JSON.parse(await readFile(path,'utf8')));
  const retained=[prior.membershipPath,prior.tocPath,...(prior.sourceArchive?[prior.sourceArchive.proofPath]:[prior.sourcePath]),...(prior.tocProjection?[prior.tocProjection.parentPath,prior.tocProjection.receiptPath]:[])];
  for(const item of retained)if(!(await realpath(item)).startsWith(prefix))throw new Error('Identical-source evidence outside archive');
  return resolve(path);
 }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
}
export async function prepareIdenticalPublication(args:{priorReceiptPath:string;sourcePath:string;sourceUrl:string;tocPath:string;tocUrl:string;tocProjection?:TicPublication['tocProjection'];directory:string;guard:()=>void;outputLimitBytes?:number;keyPath?:string}){
 const limit=args.outputLimitBytes??8_000_000_000;
 if(!Number.isSafeInteger(limit)||limit<1||limit>8_000_000_000)throw new Error('Invalid identical-source output limit');
 httpsUrl.parse(args.sourceUrl);httpsUrl.parse(args.tocUrl);
 const url=new URL(args.sourceUrl);if(url.username||url.password||Buffer.byteLength(args.sourceUrl)>65_536)throw new Error('Invalid identical-source URL');
 const source=resolve(args.sourcePath),directory=resolve(args.directory),priorPath=resolve(args.priorReceiptPath);
 args.guard();const owner=await lstat(directory,{bigint:true}),before=await lstat(source,{bigint:true});
 if(!owner.isDirectory()||await realpath(directory)!==directory||!before.isFile()||before.size>BigInt(5_000_000_000)||before.dev!==owner.dev||await realpath(source)!==source)throw new Error('Unsafe identical-source input');
 const guard=()=>{args.guard();const dir=lstatSync(directory,{bigint:true});if(dir.dev!==owner.dev||dir.ino!==owner.ino||realpathSync(directory)!==directory||!same(lstatSync(source,{bigint:true}),before))throw new Error('Identical-source input changed');};
 guard();const prior=await validatePublication(JSON.parse(await readFile(priorPath,'utf8')),args.keyPath);
 if(!prior.sourceArchive)throw new Error('Identical-source reuse requires authenticated acceptance');
 const acceptance=await verifySourceProof(prior,prior.sourceArchive,args.keyPath);
 if(acceptance.sourceSha256!==prior.sourceSha256||acceptance.membershipSha256!==prior.membershipSha256||acceptance.tocSha256!==prior.tocSha256||acceptance.pairs_emitted!==prior.membershipCount||acceptance.schema!==prior.schema||BigInt(acceptance.sourceBytes)!==before.size)throw new Error('Authenticated source acceptance mismatch');
 guard();const sourceSha256=await sha256(source);guard();
 if(sourceSha256!==prior.sourceSha256)throw new Error('Identical-source bytes differ');
 const tocSha256=await sha256(args.tocPath),plans=await tocPlans(args.tocPath,args.sourceUrl);
 const membershipPath=join(directory,sourceSha256+'.ndjson'),temporary=join(directory,'.rebind-'+randomUUID()+'.ndjson');
 for(const path of [membershipPath,join(directory,'publication.json'),join(directory,'extraction.json')]){
  try{await lstat(path);throw new Error('Identical-source destination already exists');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
 guard();const output=await open(temporary,'wx',0o600);let count=0,bytes=0,buffer='',closed=false;
 try{
  const flush=async()=>{if(!buffer)return;guard();await output.writeFile(buffer);buffer='';};
  for await(const row of rows(prior.membershipPath)){
   if(row.file_url!==prior.sourceUrl||row.last_updated_on!==prior.sourceDate||row.reporting_entity!==prior.reportingEntity||row.schema!==prior.schema)throw new Error('Identical-source membership metadata changed');
   const line=JSON.stringify({...row,file_url:args.sourceUrl})+'\n';bytes+=Buffer.byteLength(line);
   if(++count>prior.membershipCount||bytes>limit)throw new Error('Identical-source output limit');
   buffer+=line;if(buffer.length>=1_000_000)await flush();
  }
  await flush();guard();
  if(count!==prior.membershipCount||await sha256(prior.membershipPath)!==prior.membershipSha256)throw new Error('Identical-source memberships changed');
  await output.sync();await output.close();closed=true;guard();await rename(temporary,membershipPath);
 }catch(e){if(!closed)await output.close();try{guard();await unlink(temporary);}catch{}throw e;}
 guard();const membershipSha256=await sha256(membershipPath),serving=await buildCompactArchive(directory,membershipSha256,rows(membershipPath),guard);
 const receipt=receiptSchema.parse({version:1,scope:'selected-file-only; plan completeness unverified',sourcePath:source,sourceUrl:args.sourceUrl,sourceSha256,tocPath:resolve(args.tocPath),tocUrl:args.tocUrl,tocSha256,tocProjection:args.tocProjection,membershipPath,membershipSha256,membershipCount:count,sourceDate:prior.sourceDate,reportingEntity:prior.reportingEntity,schema:prior.schema,plans,serving,preparedAt:new Date().toISOString()});
 await validatePublication(receipt,args.keyPath);guard();
 // The complete parser acceptance is authenticated, not fabricated by this
 // transform. Preserve its identity and record exactly how new rows were derived.
 const extraction=extractionAcceptanceSchema.parse({...acceptance,sourceSha256,membershipSha256,tocSha256,derivation:{method:'identical-source-rebind-v1',originalReceiptSha256:publicationDigest(prior),originalProofSha256:prior.sourceArchive.proofSha256,originalMembershipSha256:prior.membershipSha256,transformRevision,outputLimitBytes:limit}});
 await durableJson(join(directory,'extraction.json'),extraction);guard();await durableJson(join(directory,'publication.json'),receipt);
 return receipt;
}
