/** Deterministic Mini runner. Codex schedules this command; it never provisions cloud compute. */
import { REFRESH_POLICY,sourceWorkspaceReserve,publicationCapacity } from './lib/refresh-policy';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { discoverAnthemSelection } from './lib/anthem-selection';
import { discoverAnthemProjections, type ProjectedCandidate } from './lib/anthem-large-toc';
import { discoverIssuer, sourceIdentity, type IssuerDiscovery } from './lib/issuer-discovery';
import { conditionalSourceUnchanged, reclaimDuplicateDownload } from './lib/unchanged-source';
import { preparePublication } from './tic-refresh';
import { ticSourceCurrent } from '../src/lib/tic/freshness';
import { validatePublication, tocPlans, type TicPublication } from '../src/lib/tic/publication';
import { verifyServing } from './lib/refresh-serving-check';
import { publishManaged,planMappingIdentity } from './lib/managed-publication';
import { stateRoot, archiveRoot, atomicJson, progressJson, credential, lockRun, Deferred, requireVolume, volumeSessionGuard, storageBudget, downloadFile, sourceKey, ensureArchiveDirectory } from './lib/refresh-runtime';
type Item = {issuer:string; source?:string; state:string; reason?:string; memberships?:number; plans?:number; sourceDate?:string};
async function main(){
 if(hostname()!=='nmai-mac-mini') throw new Error('Mini host required');
 const unlock=await lockRun();
 const results:Item[]=[];
 const statusPath=join(stateRoot,'status.json');
 let db:PrismaClient|undefined;
 const blocksPath=join(stateRoot,'source-blocks.json');
 const policy=REFRESH_POLICY.version;
 const cycleStarted=Date.now();
 let blocks:Record<string,{etag:string;reason:string;policy:string}>={};
 try{blocks=JSON.parse(await readFile(blocksPath,'utf8'));}catch{}
 let lastPublishedAt:string|undefined;
 let latestSources:Record<string,{sourceDate:string;publishedAt:string}>={};
 try {const previous=JSON.parse(await readFile(statusPath,'utf8'));lastPublishedAt=previous.lastPublishedAt;latestSources=previous.latestSources??{};} catch {}
 try{
  requireVolume(); await storageBudget();
  const guard=volumeSessionGuard();
  db=new PrismaClient({datasourceUrl:await credential(),log:[]});
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
    if(issuer==='anthem'){const selected=await discoverAnthemSelection(directory,{guard});discovery=await discoverAnthemProjections(selected.tocUrl,selected.selectedPath,guard);}
    else discovery=await discoverIssuer(issuer as 'mmoh'|'cigna',directory,{guard});
   }
   catch(e){results.push({issuer,state:'blocked',reason:safeReason(e)});continue;}
   guard();await storageBudget();
   // The manifest remains authoritative about unresolved historical names and incomplete scope.
   results.push({issuer,state:'discovered',reason:discovery.scope});
   if((issuer==='cigna'&&discovery.candidates.length<16)||discovery.unresolvedCount)results.push({issuer,state:'blocked',reason:'unresolved_source_selection; see discovery scope'});
   for(const candidate of discovery.candidates){
    if(Date.now()-cycleStarted>REFRESH_POLICY.cycleMs)throw new Deferred('cycle_time_budget');
    guard();await storageBudget();
    const tocPath=candidate.tocPath??discovery.tocPath;
    const transportUrl=candidate.transportUrl??candidate.url;
    const path=new URL(candidate.url).origin+new URL(candidate.url).pathname;
    const priorRows=await db.$queryRaw<Array<{id:string;url:string;active:boolean;sourceLastUpdated:Date|null;receiptPath:string|null}>>`SELECT f.id,f.url,f.active,f."sourceLastUpdated",p."receiptPath" FROM "TicFile" f LEFT JOIN "TicRefreshPublication" p ON p."fileId"=f.id WHERE split_part(f.url,'?',1)=${path} ORDER BY f."sourceLastUpdated" DESC,f."fetchedAt" DESC`;
    const prior=priorRows.find(p=>p.active&&sourceIdentity(p.url)===sourceIdentity(candidate.url));
    let replayCandidate:TicPublication|undefined;
    if(prior?.receiptPath && ticSourceCurrent(prior.sourceLastUpdated?.toISOString(), new Date().toISOString())){
     try {
      const saved=await validatePublication(JSON.parse(await readFile(prior.receiptPath,'utf8')));
      const mappingsSame=planMappingIdentity(await tocPlans(tocPath,candidate.url))===planMappingIdentity(saved.plans);
      if(mappingsSame&&saved.sourceUrl===candidate.url)replayCandidate=saved;
      const meta=JSON.parse(await readFile(join(prior.receiptPath,'../download.json'),'utf8'));
      const head=await fetch(transportUrl,{method:'HEAD',headers:{'Accept-Encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(30000)}).catch(()=>undefined);
      const unchanged=mappingsSame&&meta.etag&&((head?.ok&&head.headers.get('etag')===meta.etag)||await conditionalSourceUnchanged(transportUrl,meta.etag));
      if(unchanged){
       const replay=await publishManaged(db,saved,prior.receiptPath,guard,archiveRoot);
       latestSources[issuer]={sourceDate:replay.sourceDate,publishedAt:replay.publishedAt};
       results.push({issuer,source:path,state:'verified_unchanged',memberships:replay.memberships,plans:replay.plans});
       continue;
      }
      // A changed ETag or mapping requires complete download, validation and a new
      // atomic content version; it must never be skipped merely because URL repeats.
     }catch(e){if(e instanceof Deferred)throw e;results.push({issuer,source:path,state:'blocked',reason:safeReason(e)});continue;}
    }
    const key=sourceKey(candidate.url);
    let etag:string|null=null;
    try {
      const head=await fetch(transportUrl,{method:'HEAD',headers:{'Accept-Encoding':'identity'},redirect:'error',signal:AbortSignal.timeout(30000)});
      if(head.ok)etag=head.headers.get('etag');
      if(!replayCandidate&&etag&&blocks[key]?.etag===etag&&blocks[key]?.policy===policy){results.push({issuer,source:path,state:'blocked',reason:blocks[key].reason});continue;}
    }catch{/* A bounded GET can still succeed when HEAD is unavailable. */}
    if(attempted>=maxFiles){results.push({issuer,source:path,state:'deferred',reason:'run_file_budget'});continue;}
    await storageBudget(sourceWorkspaceReserve());
    attempted++;
    await atomicJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'download_validate_publish'},results});
    const dir=join(directory,sourceKey(candidate.url));await ensureArchiveDirectory(dir);
    try{
     const sourcePath=join(dir,'source.json.gz');
     const download=await downloadFile(transportUrl,sourcePath,REFRESH_POLICY.sourceBytes,guard,fetch,REFRESH_POLICY.downloadMs);
     guard();await atomicJson(join(dir,'download.json'),download);
     guard();
     const reuse=replayCandidate?.sourceSha256===download.sha256;
     const receipt=reuse ? replayCandidate! : await preparePublication({sourcePath,sourceUrl:candidate.url,tocPath,tocProjection:candidate.tocProjection,tocUrl:discovery.tocUrl,directory:dir,guard,disk:{scratchRoot:dir,onProgress:progress=>progressJson(statusPath,{version:1,pid:process.pid,state:'running',lastPublishedAt,latestSources,observedAt:new Date().toISOString(),current:{issuer,source:path,phase:'ssd_extraction',progress},results})}});
     guard();await validatePublication(receipt);
     const sizes=await db.$queryRaw<Array<{bytes:bigint}>>`SELECT pg_database_size(current_database()) AS bytes`;
     const capacity=publicationCapacity(Number(sizes[0].bytes),receipt.membershipCount,receipt.plans.length);
     guard();await atomicJson(join(dir,'capacity.json'),{...capacity,observedAt:new Date().toISOString(),sourceSha256:receipt.sourceSha256});
     if(!capacity.allowed){results.push({issuer,source:path,state:'blocked',reason:'database_capacity_budget'});continue;}
     // A source reaching the publication path is complete and hash-verified; its transaction is atomic.
     const result=await publishManaged(db,receipt,reuse ? prior!.receiptPath! : join(dir,'publication.json'),()=>{guard();requireVolume();},archiveRoot);
     guard();await atomicJson(join(dir,'published.json'),result);
     if('archiveRetention' in result && 'state' in result.archiveRetention)results.push({issuer,source:path,state:'blocked',reason:'archive_retention_review_required'});
     const replayed='replayed' in result&&result.replayed;
     if(!replayed)lastPublishedAt=new Date().toISOString();
     latestSources[issuer]={sourceDate:receipt.sourceDate,publishedAt:result.publishedAt};
     results.push({issuer,source:path,state:replayed?'verified_unchanged':'published',sourceDate:receipt.sourceDate,memberships:result.memberships,plans:result.plans});
     if(reuse)await reclaimDuplicateDownload(sourcePath,receipt.sourcePath,download.sha256,guard);
     try{await verifyServing(db,result.fileId);}catch{results.push({issuer,source:path,state:'blocked',reason:'published_but_public_readback_failed'});}
    }catch(e){
     if(e&&typeof e==='object'&&'cleanupPending' in e&&e.cleanupPending)await atomicJson(join(stateRoot,'cleanup-pending-'+runId+'-'+key+'.json'),{source:path,scratchPath:'scratchPath' in e?e.scratchPath:undefined,observedAt:new Date().toISOString(),reason:'owned extraction scratch could not be safely reclaimed; verify original SSD before cleanup'});
     if(e instanceof Deferred)throw e;
     const reason=safeReason(e);
     results.push({issuer,source:path,state:'blocked',reason});
     if(etag && /source_size_limit|Membership limit exceeded|Empty or incomplete extraction|Unarchived or malformed provider reference|Unresolved provider reference|Duplicate provider reference|reference_memory_limit|requires ZIP adapter|Source is not JSON|extraction_time_limit|scratch_limit|decoded_limit|scalar_limit|depth_limit|object_key_limit|Source is stale/.test(reason)){
      blocks[key]={etag,reason,policy};await atomicJson(blocksPath,blocks);
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
