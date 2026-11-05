import {planReservationCount} from '../src/lib/tic/shared-plans';
import {compressNormalizedEvidence} from './lib/normalized-compression';
import {prepareIdenticalPublication,availableIdenticalReceipt} from './lib/identical-source';
import {compactServingEnabled,deriveCompactPublication,sharedPlansEnabled} from './lib/compact-serving';
/** Deterministic Mini runner. Codex schedules this command; it never provisions cloud compute. */
import { verifySourceProofKey } from '../src/lib/tic/source-proof';
import {recoverDownloadStages} from './lib/download-staging';
import { REFRESH_POLICY,sourceWorkspaceReserve,publicationCapacity,compatiblePreparedPolicy,compatibleSourceBlock } from './lib/refresh-policy';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join,dirname,resolve }  from 'node:path';
import { preparedSource,type PreparedSource } from './lib/prepared-source';
import { reuseSourceArchive,type SourceArchive } from './lib/source-archive';
import { hostname } from 'node:os';
import { createAnthemSelectionDiscoverer } from './lib/anthem-selection';
import { discoverAnthemProjections, type ProjectedCandidate } from './lib/anthem-large-toc';
import { createIssuerDiscoverer, sourceIdentity, type IssuerDiscovery } from './lib/issuer-discovery';
import { conditionalSourceUnchanged, reclaimDuplicateDownload, sourceValidator } from './lib/unchanged-source';
import { reclaimRejectedSource } from './lib/rejected-source-cleanup';
import { compactManagedSource } from './lib/source-compaction';
import { preparePublication } from './tic-refresh';
import { ticSourceCurrent } from '../src/lib/tic/freshness';
import { validatePublication, tocPlans, type TicPublication } from '../src/lib/tic/publication';
import { verifyServing } from './lib/refresh-serving-check';
import { publishManaged,planMappingIdentity,sameManagedContent } from './lib/managed-publication';
import { stateRoot, archiveRoot, atomicJson, progressJson, credential, lockRun, Deferred, requireVolume, volumeSessionGuard, volumeCleanupSessionGuard,downloadJournal, storageBudget, downloadFile, sourceKey, ensureArchiveDirectory } from './lib/refresh-runtime';
type Item = {issuer:string; source?:string; state:string; reason?:string; memberships?:number; plans?:number; sourceDate?:string};
async function main(){
 if(hostname()!=='nmai-mac-mini') throw new Error('Mini host required');
 const unlock=await lockRun();
 const results:Item[]=[];
 const statusPath=join(stateRoot,'status.json');
 let db:PrismaClient|undefined;
 const blocksPath=join(stateRoot,'source-blocks.json');
 let policy:string=REFRESH_POLICY.version;
 const cycleStarted=performance.now();
 let blocks:Record<string,{etag:string;reason:string;policy:string}>={};
 const preparedPath=join(stateRoot,'prepared-sources.json');
 const archivesPath=join(stateRoot,'source-archives.json');
 const contentPath=join(stateRoot,'validated-content.json');
 let content:Record<string,string>={};
 try{content=JSON.parse(await readFile(contentPath,'utf8'));}catch{}
 let archives:Record<string,SourceArchive>={};
 try{archives=JSON.parse(await readFile(archivesPath,'utf8'));}catch{}
 let prepared:Record<string,PreparedSource>={};
 try{prepared=JSON.parse(await readFile(preparedPath,'utf8'));}catch{}
 try{blocks=JSON.parse(await readFile(blocksPath,'utf8'));}catch{}
 let lastPublishedAt:string|undefined;
 let latestSources:Record<string,{sourceDate:string;publishedAt:string}>={};
 try {const previous=JSON.parse(await readFile(statusPath,'utf8'));lastPublishedAt=previous.lastPublishedAt;latestSources=previous.latestSources??{};} catch {}
 try{
  const cleanupGuard=volumeCleanupSessionGuard();
  try{await recoverDownloadStages(downloadJournal,cleanupGuard);}catch(e){cleanupGuard();throw e;}
  requireVolume(); await storageBudget();await verifySourceProofKey();
  const guardVolume=volumeSessionGuard();
  const guard=()=>{if(performance.now()-cycleStarted>REFRESH_POLICY.cycleMs)throw new Deferred('cycle_time_budget');guardVolume();};
  const cycleFetch:typeof fetch=async(input,init)=>{
   guard();const remaining=Math.max(1,Math.floor(REFRESH_POLICY.cycleMs-(performance.now()-cycleStarted)));
   const deadline=AbortSignal.timeout(remaining);
   try{return await fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,deadline]):deadline});}
   catch(e){guard();throw e;}
  };
  const discoverIssuer=createIssuerDiscoverer({fetch:cycleFetch});
  const discoverAnthemSelection=createAnthemSelectionDiscoverer({fetch:cycleFetch});
  db=new PrismaClient({datasourceUrl:await credential(),log:[]});
  const sharedPlans=await sharedPlansEnabled(stateRoot,db,cycleFetch);
  const compact=await compactServingEnabled(stateRoot,db,cycleFetch);if(compact)policy+='-npi-prefix-v1';
  const compactEligible=async(receiptPath:string)=>{
   const canonical=resolve(receiptPath),relative=canonical.slice(archiveRoot.length);
   if(!canonical.startsWith(archiveRoot+'/')||!/^\/scheduled\/(mmoh|cigna|anthem)\/\d{4}-\d{2}-\d{2}T[\dZ-]+\/[a-f0-9]+\/(?:compact-)?publication\.json$/.test(relative))return;
   let extraction;
   try{extraction=JSON.parse(await readFile(join(dirname(canonical),'extraction.json'),'utf8'));}
   catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
   if(!extraction.validation)return; // Historical raw cannot be retroactively sealed.
   const result=await compactManagedSource(db!,canonical,dirname(dirname(canonical)),guard,Object.values(prepared).map(p=>p.receiptPath));
   if(result.receipt.sourceArchive){content[result.receipt.sourceSha256]=canonical;await atomicJson(contentPath,content);}
   try{await compressNormalizedEvidence({receiptPath:canonical,root:archiveRoot,guard,cleanupGuard,reserve:storageBudget});}
   catch(e){if(e instanceof Deferred)throw e;throw Error('normalized_evidence_compression_requires_review');}
  };
  const runId=new Date().toISOString().replace(/[:.]/g,'-');
  await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{phase:'discovery'},results});
  const selected=process.argv.includes('--issuer') ? [process.argv[process.argv.indexOf('--issuer')+1]] : ['mmoh','cigna','anthem'];
  if(selected.some(x=>!['mmoh','cigna','anthem'].includes(x)))throw new Error('Unknown issuer');
  const maxFiles=Number(process.env.AFFINITY_REFRESH_MAX_FILES??REFRESH_POLICY.newFilesPerCycle);
  if(!Number.isSafeInteger(maxFiles)||maxFiles<1||maxFiles>1000)throw new Error('Invalid run file budget');
  let attempted=0;
  for(const issuer of selected){
   guard();
   const directory=join(archiveRoot,'scheduled',issuer,runId);
   await ensureArchiveDirectory(directory);
   let discovery:Omit<IssuerDiscovery,'candidates'>&{unresolvedCount?:number;candidates:Array<IssuerDiscovery['candidates'][number]&Partial<ProjectedCandidate>>};
   try{
    if(issuer==='anthem'){const selected=await discoverAnthemSelection(directory,{guard});discovery=await discoverAnthemProjections(selected.tocUrl,selected.selectedPath,guard,cycleFetch);}
    else discovery=await discoverIssuer(issuer as 'mmoh'|'cigna',directory,{guard});
   }
   catch(e){guard();results.push({issuer,state:'blocked',reason:safeReason(e)});continue;}
   guard();await storageBudget();
   // Process existing archived candidates first; unchanged sources are still
   // checked even after the new-attempt allowance is exhausted.
   discovery.candidates.sort((a,b)=>(archives[sourceKey(a.url)]?.bytes??Infinity)-(archives[sourceKey(b.url)]?.bytes??Infinity)||a.url.localeCompare(b.url));
   // The manifest remains authoritative about unresolved historical names and incomplete scope.
   results.push({issuer,state:'discovered',reason:discovery.scope});
   if((issuer==='cigna'&&discovery.candidates.length<16)||discovery.unresolvedCount)results.push({issuer,state:'blocked',reason:'unresolved_source_selection; see discovery scope'});
   for(const candidate of discovery.candidates){
    guard();await storageBudget();
    const tocPath=candidate.tocPath??discovery.tocPath;
    const transportUrl=candidate.transportUrl??candidate.url;
    const path=new URL(candidate.url).origin+new URL(candidate.url).pathname;
    const priorRows=await db.$queryRaw<Array<{id:string;url:string;active:boolean;sourceLastUpdated:Date|null;receiptPath:string|null}>>`SELECT f.id,f.url,f.active,f."sourceLastUpdated",p."receiptPath" FROM "TicFile" f LEFT JOIN "TicRefreshPublication" p ON p."fileId"=f.id WHERE split_part(f.url,'?',1)=${path} ORDER BY f."sourceLastUpdated" DESC,f."fetchedAt" DESC`;
    const prior=priorRows.find(p=>p.active&&sourceIdentity(p.url)===sourceIdentity(candidate.url));
    let replayCandidate:TicPublication|undefined;
    if(prior?.receiptPath && ticSourceCurrent(prior.sourceLastUpdated?.toISOString(), new Date().toISOString())){
     await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'verify_existing_evidence'},results});
     try {
      const saved=await validatePublication(JSON.parse(await readFile(prior.receiptPath,'utf8')));
      const mappingsSame=planMappingIdentity(await tocPlans(tocPath,candidate.url))===planMappingIdentity(saved.plans);
      if(mappingsSame&&saved.sourceUrl===candidate.url)replayCandidate=saved;
      const meta=JSON.parse(await readFile(join(prior.receiptPath,'../download.json'),'utf8'));
      const head=await cycleFetch(transportUrl,{method:'HEAD',headers:{'Accept-Encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(30000)}).catch(()=>undefined);
      const unchanged=mappingsSame&&meta.etag&&((head?.ok&&head.headers.get('etag')===meta.etag)||await conditionalSourceUnchanged(transportUrl,meta.etag,cycleFetch));
      if(unchanged){
       const replay=await publishManaged(db,saved,prior.receiptPath,guard,archiveRoot,undefined,sharedPlans);
       latestSources[issuer]={sourceDate:replay.sourceDate,publishedAt:replay.publishedAt};
       results.push({issuer,source:path,state:'verified_unchanged',memberships:replay.memberships,plans:replay.plans});
       await compactEligible(prior.receiptPath);
       continue;
      }
      // A changed ETag or mapping requires complete download, validation and a new
      // atomic content version; it must never be skipped merely because URL repeats.
     }catch(e){if(e instanceof Deferred)throw e;results.push({issuer,source:path,state:'blocked',reason:safeReason(e)});continue;}
    }
    const key=sourceKey(candidate.url);
    let etag:string|null=null;
    try {
      // Some issuer frontends use a different HEAD validator. A 304 from the
      // actual GET representation may reuse a known block/preparation safely.
      const known=compatibleSourceBlock(blocks[key],policy)?blocks[key].etag:compatiblePreparedPolicy(prepared[key]?.policy,compact)?prepared[key].etag:undefined;
      etag=await sourceValidator(transportUrl,known,cycleFetch);
      if(!replayCandidate&&etag&&blocks[key]?.etag===etag&&compatibleSourceBlock(blocks[key],policy)){results.push({issuer,source:path,state:'blocked',reason:blocks[key].reason});continue;}
    }catch{/* A bounded GET can still succeed when HEAD is unavailable. */}
    let cached:TicPublication|undefined;
    try{cached=await preparedSource(prepared[key],{etag,policy:compatiblePreparedPolicy(prepared[key]?.policy,compact)??policy,sourceUrl:candidate.url,tocPath,root:archiveRoot});}
    catch(e){if(e instanceof Deferred)throw e;results.push({issuer,source:path,state:'blocked',reason:'prepared_source_requires_review'});continue;}
    if(!cached){
     if(attempted>=maxFiles){results.push({issuer,source:path,state:'deferred',reason:'run_file_budget'});continue;}
     await storageBudget(sourceWorkspaceReserve(undefined,compact));attempted++;
    }
    await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'download_validate_publish'},results});
    const dir=cached?dirname(prepared[key].receiptPath):join(directory,sourceKey(candidate.url));await ensureArchiveDirectory(dir);
    try{
     const sourcePath=join(dir,'source.json.gz');
     const archived=cached?undefined:await reuseSourceArchive(archives[key],{sourceUrl:candidate.url,etag,destination:sourcePath,root:archiveRoot,maxBytes:REFRESH_POLICY.sourceBytes,guard});
     const download=cached?JSON.parse(await readFile(join(dir,'download.json'),'utf8')):archived??await downloadFile(transportUrl,sourcePath,REFRESH_POLICY.sourceBytes,guard,cycleFetch,REFRESH_POLICY.downloadMs);
     guard();if(!cached)await atomicJson(join(dir,'download.json'),download);
     if(!cached){archives[key]={sourceUrl:candidate.url,path:sourcePath,bytes:download.bytes,sha256:download.sha256,etag:download.etag,lastModified:download.lastModified};await atomicJson(archivesPath,archives);}
     guard();
     const reuse=!cached&&replayCandidate?.sourceSha256===download.sha256;
     let identicalPath=compact&&!cached&&!reuse?content[download.sha256]:undefined;
     if(identicalPath){
      identicalPath=await availableIdenticalReceipt(identicalPath,archiveRoot);
      if(!identicalPath){delete content[download.sha256];await atomicJson(contentPath,content);}
     }
     if(identicalPath)await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'identical_source_validation'},results});
     let receipt=cached??(reuse ? replayCandidate! : identicalPath?await prepareIdenticalPublication({priorReceiptPath:identicalPath,sourcePath,sourceUrl:candidate.url,tocPath,tocProjection:candidate.tocProjection,tocUrl:discovery.tocUrl,directory:dir,guard}):await preparePublication({sourcePath,sourceUrl:candidate.url,tocPath,tocProjection:candidate.tocProjection,tocUrl:discovery.tocUrl,directory:dir,guard,compact,disk:{scratchRoot:dir,onProgress:progress=>progressJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'ssd_extraction',progress},results})}}));
     let publicationPath=cached?prepared[key].receiptPath:reuse?prior!.receiptPath!:join(dir,'publication.json');
     if(compact&&!receipt.serving&&!reuse){const derived=await deriveCompactPublication(receipt,publicationPath,guard);receipt=derived.receipt;publicationPath=derived.receiptPath;}
     guard();await validatePublication(receipt);
     await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'capacity_check'},results});
     const verifiedReplay=sameManagedContent(receipt,replayCandidate);
     if(!reuse&&etag){prepared[key]={etag,policy,receiptPath:publicationPath};await atomicJson(preparedPath,prepared);}
     const sizes=await db.$queryRaw<Array<{bytes:bigint}>>`SELECT pg_database_size(current_database()) AS bytes`;
     const capacity=publicationCapacity(Number(sizes[0].bytes),receipt.membershipCount,receipt.plans.length,verifiedReplay,receipt.serving,await planReservationCount(db,receipt.plans,sharedPlans));
     guard();await atomicJson(join(dir,'capacity.json'),{...capacity,observedAt:new Date().toISOString(),sourceSha256:receipt.sourceSha256});
     if(!capacity.allowed){
      if(!reuse)await compactEligible(publicationPath);
      results.push({issuer,source:path,state:'blocked',reason:'database_capacity_budget'});continue;
     }
     // A source reaching the publication path is complete and hash-verified; its transaction is atomic.
     await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'atomic_publish'},results});
     const result=await publishManaged(db,receipt,publicationPath,()=>{guard();requireVolume();},archiveRoot,undefined,sharedPlans);
     guard();await atomicJson(join(dir,'published.json'),result);
     if(prepared[key]){delete prepared[key];await atomicJson(preparedPath,prepared);}
     if('archiveRetention' in result && 'state' in result.archiveRetention)results.push({issuer,source:path,state:'blocked',reason:'archive_retention_review_required'});
     const replayed='replayed' in result&&result.replayed;
     if(reuse&&replayed)attempted--; // Full-GET proof reconciles the provisional new-content attempt.
     if(!replayed)lastPublishedAt=new Date().toISOString();
     latestSources[issuer]={sourceDate:receipt.sourceDate,publishedAt:result.publishedAt};
     results.push({issuer,source:path,state:replayed?'verified_unchanged':'published',sourceDate:receipt.sourceDate,memberships:result.memberships,plans:result.plans});
     if(reuse){archives[key]={...archives[key],path:receipt.sourcePath};await atomicJson(archivesPath,archives);await reclaimDuplicateDownload(sourcePath,receipt.sourcePath,download.sha256,guard,receipt);}
     await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'serving_readback'},results});
     try{await verifyServing(db,result.fileId);}catch{results.push({issuer,source:path,state:'blocked',reason:'published_but_public_readback_failed'});}
     if(!reuse){
      try{await compactEligible(publicationPath);}
      catch(e){if(e instanceof Deferred)throw e;results.push({issuer,source:path,state:'blocked',reason:e instanceof Error&&e.message==='normalized_evidence_compression_requires_review'?e.message:'published_source_compaction_requires_review'});}
     }
    }catch(e){
     if(e&&typeof e==='object'&&'cleanupPending' in e&&e.cleanupPending)await atomicJson(join(stateRoot,'cleanup-pending-'+runId+'-'+key+'.json'),{source:path,scratchPath:'scratchPath' in e?e.scratchPath:undefined,observedAt:new Date().toISOString(),reason:'owned extraction scratch could not be safely reclaimed; verify original SSD before cleanup'});
     if(e instanceof Deferred)throw e;
     const reason=safeReason(e);
     results.push({issuer,source:path,state:'blocked',reason});
     if(etag && /source_size_limit|Membership limit exceeded|Empty or incomplete extraction|Unarchived or malformed provider reference|Unresolved provider reference|Duplicate provider reference|reference_memory_limit|requires ZIP adapter|Source is not JSON|extraction_time_limit|scratch_limit|decoded_limit|scalar_limit|depth_limit|object_key_limit|Source is stale/.test(reason)){
      blocks[key]={etag,reason,policy};await atomicJson(blocksPath,blocks);
      if(!cached){
       try{
        const retained=await db.$queryRaw<Array<{receiptPath:string}>>`SELECT "receiptPath" FROM "TicRefreshPublication"`;
        await reclaimRejectedSource({directory:dir,ownedRunRoot:directory,reason,guard,retainedReceiptPaths:[...retained.map(r=>r.receiptPath),...Object.values(prepared).map(p=>p.receiptPath)]});
       }catch{results.push({issuer,source:path,state:'blocked',reason:'rejected_source_cleanup_requires_review'});}
      }
     }
    }
    await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),results});
   }
  }
  const state=results.some(x=>x.state==='blocked'||x.state==='deferred')?'partial':'complete_for_discovered_scope';
  const receipt={version:1,pid:process.pid,state,lastPublishedAt,latestSources,observedAt:new Date().toISOString(),results};
  await atomicJson(statusPath,receipt);console.log(JSON.stringify(receipt));
 }catch(e){
  const receipt={version:1,pid:process.pid,lastPublishedAt,latestSources,state:e instanceof Deferred?'deferred':'failed',reason:safeReason(e),observedAt:new Date().toISOString(),results};
  await atomicJson(statusPath,receipt);console.log(JSON.stringify(receipt));
  if(!(e instanceof Deferred))process.exitCode=1;
 }finally{await db?.$disconnect();await unlock();}
}
function safeReason(e:unknown){
 // Prisma and HTTP errors can include connection strings or signed request URLs.
 const message=e instanceof Error?e.message:'unknown_failure';
 if(message.includes('://') || message.includes('Invocation') || message.length>180)return 'operation_failed_check_protected_checkpoint';
 return message;
}
main().catch(error=>{
 if(error instanceof Deferred){console.log(JSON.stringify({state:'deferred',reason:error.message,observedAt:new Date().toISOString()}));return;}
 console.error('Refresh could not acquire local state; no publication attempted.');process.exitCode=1;
});
