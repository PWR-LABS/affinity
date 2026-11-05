import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {gzipSync} from 'node:zlib';
import {preparePublication} from '../scripts/tic-refresh';
import {prepareIdenticalPublication,availableIdenticalReceipt} from '../scripts/lib/identical-source';
import {compactSourceArchive} from '../scripts/lib/source-compaction';
import {createSourceProofKey,verifySourceProof} from '../src/lib/tic/source-proof';
import {sha256,validatePublication} from '../src/lib/tic/publication';
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'affinity-identical-')));const keyPath=join(root,'key');await createSourceProofKey(keyPath);
 const date=new Date(Date.now()-86400000).toISOString().slice(0,10),bytes=gzipSync(JSON.stringify({reporting_entity_name:'Exact source',last_updated_on:date,version:'2.0.0',in_network:[{negotiated_rates:[{provider_references:[7,7]}]}],provider_references:[{provider_group_id:7,provider_groups:[{npi:[1234567890,1234567890,2234567890,0,123456789],tin:{type:'EIN',value:'111111111'}}]}]}));
 async function input(name:string,url:string,planId:string){const directory=join(root,name);await mkdir(directory);const sourcePath=join(directory,'source.json.gz'),tocPath=join(directory,'toc.json');await writeFile(sourcePath,bytes);await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:url}],reporting_plans:[{plan_name:name,plan_id_type:'EIN',plan_id:planId,plan_market_type:'group'}]}]}));await writeFile(join(directory,'download.json'),JSON.stringify({bytes:bytes.length,sha256:await sha256(sourcePath)}));return {directory,sourcePath,tocPath,sourceUrl:url,tocUrl:'https://example.com/toc',guard:()=>{},keyPath};}
 const original=await input('original','https://example.com/original','111111111');await preparePublication({...original,compact:true,disk:{scratchRoot:original.directory}});const priorReceiptPath=join(original.directory,'publication.json');await compactSourceArchive({receiptPath:priorReceiptPath,ownedRunRoot:root,guard:()=>{},retainedReceiptPaths:[],keyPath});
 return {root,keyPath,bytes,input,priorReceiptPath};
}
test('identical-source acceptance preserves full rows while rebuilding the URL and exact target plan mapping',async()=>{
 const f=await fixture();try{
  const target=await f.input('target','https://example.com/mirror','222222222'),normal=await f.input('normal','https://example.com/mirror','222222222');
  // Use the exact same target TOC for the independent full-parser comparison.
  normal.tocPath=target.tocPath;
  const rebound=await prepareIdenticalPublication({...target,priorReceiptPath:f.priorReceiptPath,outputLimitBytes:100_000});
  const parsed=await preparePublication({...normal,compact:true,disk:{scratchRoot:normal.directory}});
  assert.equal(await readFile(rebound.membershipPath,'utf8'),await readFile(parsed.membershipPath,'utf8'));assert.deepEqual(rebound.plans,parsed.plans);assert.equal(rebound.plans[0].planId,'222222222');assert.equal(rebound.sourceSha256,parsed.sourceSha256);assert.equal(rebound.serving?.npiSha256,parsed.serving?.npiSha256);
  const extraction=JSON.parse(await readFile(join(target.directory,'extraction.json'),'utf8'));assert.equal(extraction.derivation.method,'identical-source-rebind-v1');assert.equal(extraction.pairs_emitted,parsed.membershipCount);
  const sealed=await compactSourceArchive({receiptPath:join(target.directory,'publication.json'),ownedRunRoot:f.root,guard:()=>{},retainedReceiptPaths:[f.priorReceiptPath],keyPath:f.keyPath});
  await assert.rejects(stat(target.sourcePath),{code:'ENOENT'});await validatePublication(sealed.receipt,f.keyPath);
  const authenticated=await verifySourceProof(sealed.receipt,sealed.receipt.sourceArchive!,f.keyPath);assert.deepEqual(authenticated.derivation,extraction.derivation);
  const next=await f.input('next','https://example.com/another-mirror','333333333');const again=await prepareIdenticalPublication({...next,priorReceiptPath:join(target.directory,'publication.json')});assert.equal(again.serving?.npiSha256,rebound.serving?.npiSha256);assert.equal(again.plans[0].planId,'333333333');
  const proofPath=sealed.receipt.sourceArchive!.proofPath,proof=JSON.parse(await readFile(proofPath,'utf8'));proof.body.extraction.derivation.originalReceiptSha256='0'.repeat(64);await writeFile(proofPath,JSON.stringify(proof));
  await assert.rejects(verifySourceProof(sealed.receipt,{...sealed.receipt.sourceArchive!,proofSha256:await sha256(proofPath)},f.keyPath),/authentication mismatch/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('byte mismatch, unauthenticated acceptance, wrong key, target mapping mismatch and output overflow fail closed',async()=>{
 const f=await fixture();try{
  const prior=JSON.parse(await readFile(f.priorReceiptPath,'utf8'));
  const changed=await f.input('changed','https://example.com/changed','222222222');await writeFile(changed.sourcePath,Buffer.from(f.bytes).fill(0,10,11));await assert.rejects(prepareIdenticalPublication({...changed,priorReceiptPath:f.priorReceiptPath}),/bytes differ/);
  const raw=await f.input('raw','https://example.com/raw','333333333');await preparePublication({...raw,compact:true,disk:{scratchRoot:raw.directory}});const target=await f.input('unauthenticated','https://example.com/new','444444444');await assert.rejects(prepareIdenticalPublication({...target,priorReceiptPath:join(raw.directory,'publication.json')}),/authenticated acceptance/);
  const wrongKey=join(f.root,'other-key');await createSourceProofKey(wrongKey);await assert.rejects(prepareIdenticalPublication({...target,priorReceiptPath:f.priorReceiptPath,keyPath:wrongKey}),/authentication mismatch/);
  const mismatch=await f.input('mapping','https://example.com/not-selected','555555555');await assert.rejects(prepareIdenticalPublication({...mismatch,sourceUrl:'https://example.com/absent',priorReceiptPath:f.priorReceiptPath}),/no plan mapping/);
  const bounded=await f.input('bounded','https://example.com/bounded','666666666');await assert.rejects(prepareIdenticalPublication({...bounded,priorReceiptPath:f.priorReceiptPath,outputLimitBytes:1}),/output limit/);await assert.rejects(stat(join(bounded.directory,'publication.json')),{code:'ENOENT'});assert.equal(await sha256(bounded.sourcePath),prior.sourceSha256);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('a source replaced during transformation is rejected and the original authenticated receipt remains usable',async()=>{
 const f=await fixture();try{
  const target=await f.input('mutation','https://example.com/mutation','222222222');let calls=0;
  const {writeFileSync}=await import('node:fs');const guard=()=>{if(++calls===4)writeFileSync(target.sourcePath,Buffer.alloc(f.bytes.length));};
  await assert.rejects(prepareIdenticalPublication({...target,guard,priorReceiptPath:f.priorReceiptPath}),/input changed/);
  await assert.rejects(stat(join(target.directory,'publication.json')),{code:'ENOENT'});
  await validatePublication(JSON.parse(await readFile(f.priorReceiptPath,'utf8')),f.keyPath);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('retired normalized bytes are a cache miss while paths outside the archive fail closed',async()=>{
 const f=await fixture();try{
  assert.equal(await availableIdenticalReceipt(f.priorReceiptPath,f.root),f.priorReceiptPath);
  const prior=JSON.parse(await readFile(f.priorReceiptPath,'utf8'));await rm(prior.membershipPath);
  assert.equal(await availableIdenticalReceipt(f.priorReceiptPath,f.root),undefined);
  await assert.rejects(availableIdenticalReceipt('/outside/publication.json',f.root),/outside archive/);
  await assert.rejects(availableIdenticalReceipt(123,f.root),/outside archive/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
