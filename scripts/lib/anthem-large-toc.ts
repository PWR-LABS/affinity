import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { buildSelectedToc } from '../../tools/tic-ingest/selected-toc';
import { sha256, type TicPublication } from '../../src/lib/tic/publication';
import { validateTocLineage } from '../../src/lib/tic/toc-lineage';
import { sourceIdentity } from './issuer-discovery';
import { ticSourceCurrent } from '../../src/lib/tic/freshness';
import { stateRoot,archiveRoot,atomicJson,progressJson,sourceKey,downloadFile,storageBudget,ensureArchiveDirectory } from './refresh-runtime';
export type ProjectedCandidate={url:string;transportUrl:string;stableKey:string;tocPath:string;tocProjection:NonNullable<TicPublication['tocProjection']>};
/** Immutable parent evidence stays unchanged; only known signing fields may renew. */
export function renewedAnthemTransport(sourceUrl:string,selected:string[]):string {
 const identity=sourceIdentity(sourceUrl);
 const candidate=selected.find(url=>sourceIdentity(url)===identity);
 if(!candidate)throw new Error('Anthem renewed transport identity mismatch');
 const url=new URL(candidate);
 if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Unsafe Anthem transport URL');
 return candidate;
}
type Cache={tocUrl:string;etag:string|null;parentPath:string;download:{bytes:number;sha256:string};selectionSha256?:string;planScopeSha256?:string;receiptPath?:string};
const cachePath=join(stateRoot,'anthem-large-toc.json');
export async function discoverAnthemProjections(tocUrl:string,selectedPath:string,guard:()=>void,fetcher=fetch){
 const u=new URL(tocUrl);
 if(!/^antm-pt-prod-dataz-nogbd-nophi-us-east[12]\.s3(?:\.us-east-2)?\.amazonaws\.com$/.test(u.hostname)||!/^\/anthem\/\d{4}-\d{2}-01_anthem_index\.json\.gz$/.test(u.pathname)||u.protocol!=='https:')throw new Error('Unverified Anthem TOC locator');
 guard();
 const head=await fetcher(tocUrl,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!head.ok)throw new Error('Anthem TOC HEAD unavailable');
 const bytes=Number(head.headers.get('content-length')),etag=head.headers.get('etag');
 if(!Number.isSafeInteger(bytes)||bytes<=0||bytes>12_000_000_000)throw new Error('Anthem TOC exceeds local archive budget');
 let cache:Cache|undefined;
 try{cache=JSON.parse(await readFile(cachePath,'utf8'));}catch{}
 if(cache && (cache.tocUrl!==tocUrl||!etag||cache.etag!==etag||cache.download.bytes!==bytes||!resolve(cache.parentPath).startsWith(archiveRoot+'/')))cache=undefined;
 if(cache){try{if((await stat(cache.parentPath)).size!==bytes)cache=undefined;}catch{cache=undefined;}}
 if(!cache){
  await storageBudget(bytes+2_000_000_000);
  const directory=join(archiveRoot,'large-toc',sourceKey(tocUrl+'?etag='+encodeURIComponent(etag??Date.now().toString())));await ensureArchiveDirectory(directory);
  const parentPath=join(directory,'index.json.gz');
  await atomicJson(join(stateRoot,'large-toc-status.json'),{state:'downloading',startedAt:new Date().toISOString(),bytes});
  const download=await downloadFile(tocUrl,parentPath,12_000_000_000,guard,fetcher,3600000);
  cache={tocUrl,etag,parentPath,download};guard();await atomicJson(cachePath,cache);
 }
 const selected=JSON.parse(await readFile(selectedPath,'utf8')) as string[];
 const identity=(items:string[])=>createHash('sha256').update(JSON.stringify([...items].sort())).digest('hex');
 const selectionSha256=identity(selected.map(sourceIdentity));
 const planScope=JSON.parse(await readFile(join(stateRoot,'anthem-plan-scope.json'),'utf8'));
 const planScopeSha256=identity(planScope.identities);
 if(cache.selectionSha256!==selectionSha256||cache.planScopeSha256!==planScopeSha256||!cache.receiptPath){
  await storageBudget(2_000_000_000);
  await atomicJson(join(stateRoot,'large-toc-status.json'),{state:'validating_complete_toc',startedAt:new Date().toISOString(),bytes});
  const result=await buildSelectedToc({planIdentities:planScope.identities,onProgress:stats=>progressJson(join(stateRoot,'large-toc-status.json'),{state:'validating_complete_toc',...stats,totalCompressedBytes:bytes,observedAt:new Date().toISOString()}),input:cache.parentPath,selected:selectedPath,outDir:dirname(cache.parentPath),guard});
  if(result.parentSha256!==cache.download.sha256)throw new Error('Anthem parent differs from download receipt');
  cache={...cache,selectionSha256,planScopeSha256,receiptPath:result.receiptPath};guard();await atomicJson(cachePath,cache);
 }
 const receipt=JSON.parse(await readFile(cache.receiptPath!,'utf8'));
 if(identity(receipt.planSelection?.identities??[])!==planScopeSha256)throw new Error('Anthem employer scope mismatch');
 if(identity([...receipt.projections.map((p:{selected:string})=>p.selected),...receipt.unresolved.map((p:{selected:string})=>p.selected)].map(sourceIdentity))!==selectionSha256||!ticSourceCurrent(receipt.parent?.sourceDate,new Date().toISOString()))throw new Error('Anthem projection selection or freshness mismatch');
 const lineage={receiptPath:cache.receiptPath!,receiptSha256:await sha256(cache.receiptPath!),parentPath:cache.parentPath,parentSha256:cache.download.sha256};
 const candidates:ProjectedCandidate[]=[];
 for(const p of receipt.projections){
  guard();const tocPath=resolve(dirname(cache.receiptPath!),p.file);
  if(dirname(tocPath)!==dirname(resolve(cache.receiptPath!)))throw new Error('Anthem projection path escape');
  await validateTocLineage(lineage,tocPath,p.sha256,p.sourceUrl);
  if(await sha256(tocPath)!==p.sha256)throw new Error('Anthem projection changed');
  candidates.push({url:p.sourceUrl,transportUrl:renewedAnthemTransport(p.sourceUrl,selected),stableKey:sourceKey(p.sourceUrl),tocPath,tocProjection:lineage});
 }
 await atomicJson(join(stateRoot,'large-toc-status.json'),{state:'validated',observedAt:new Date().toISOString(),projected:candidates.length,unresolved:receipt.unresolved.length,parentSha256:lineage.parentSha256});
 return {unresolvedCount:receipt.unresolved.length,tocUrl,tocPath:'',sourceDate:receipt.parent.sourceDate as string,candidates,scope:`Anthem four-EIN file selection and ${planScope.identities.length} existing employer identities; ${candidates.length} complete parent-verified file mappings; ${receipt.unresolved.length} unresolved. Whole-plan and national completeness unverified.`};
}
