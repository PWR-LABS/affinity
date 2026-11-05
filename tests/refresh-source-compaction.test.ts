import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat,rename} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePublication} from '../scripts/tic-refresh';
import {validatePublication,sha256,receiptSchema} from '../src/lib/tic/publication';
import {createSourceProofKey} from '../src/lib/tic/source-proof';
import {compactSourceArchive} from '../scripts/lib/source-compaction';
import {reclaimDuplicateDownload} from '../scripts/lib/unchanged-source';
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){
 const root=realpathSync(await mkdtemp(join(tmpdir(),'affinity-compaction-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const keyDir=join(root,'private'),ownedRunRoot=join(root,'run'),dir=join(ownedRunRoot,'source');await mkdir(keyDir,{mode:0o700});await mkdir(dir,{recursive:true});
 const keyPath=join(keyDir,'key');await createSourceProofKey(keyPath);
 const sourcePath=join(dir,'source.json.gz'),tocPath=join(dir,'toc.json'),sourceUrl='https://example.com/network.json';
 await writeFile(sourcePath,JSON.stringify({reporting_entity_name:'Fixture',last_updated_on:new Date(Date.now()-86400000).toISOString().slice(0,10),version:'1.0.0',in_network:[{negotiated_rates:[{provider_groups:[{npi:[1234567890],tin:{type:'ein',value:'111111111'}}]}]}]}));
 await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_id_type:'ein',plan_id:'111111111',plan_name:'Fixture',plan_market_type:'group'}]}]}));
 const receipt=await preparePublication({sourcePath,sourceUrl,tocPath,tocUrl:'https://example.com/toc',directory:dir,disk:{scratchRoot:dir}});
 await writeFile(join(dir,'download.json'),JSON.stringify({bytes:(await stat(sourcePath)).size,sha256:receipt.sourceSha256}));
 const options={receiptPath:join(dir,'publication.json'),ownedRunRoot,guard:()=>{},retainedReceiptPaths:[] as string[],keyPath};
 return {root,dir,keyDir,keyPath,receipt,options};
}
test('complete local evidence survives owned raw compaction, duplicate cleanup and idempotent recovery',async t=>{
 const f=await fixture(t),raw=await readFile(f.receipt.sourcePath),sourceDate=f.receipt.sourceDate;
 const result=await compactSourceArchive(f.options);assert.equal(result.state,'compacted');
 await assert.rejects(stat(f.receipt.sourcePath),{code:'ENOENT'});
 const compacted=await validatePublication(JSON.parse(await readFile(f.options.receiptPath,'utf8')),f.keyPath);
 assert.equal(compacted.sourceDate,sourceDate);assert.equal(compacted.membershipCount,1);assert.ok(await stat(compacted.tocPath));
 assert.equal((await compactSourceArchive(f.options)).state,'already_compacted');
 const {preparedSource}=await import('../scripts/lib/prepared-source');
 assert.equal((await preparedSource({etag:'fixture',policy:'fixture',receiptPath:f.options.receiptPath},{etag:'fixture',policy:'fixture',sourceUrl:compacted.sourceUrl,tocPath:compacted.tocPath,root:f.root,archiveKeyPath:f.keyPath}))?.sourceSha256,compacted.sourceSha256);
 const duplicate=join(f.root,'duplicate');await mkdir(duplicate);const duplicatePath=join(duplicate,'source.json.gz');await writeFile(duplicatePath,raw);await writeFile(join(duplicate,'download.json'),JSON.stringify({sha256:compacted.sourceSha256}));
 await reclaimDuplicateDownload(duplicatePath,compacted.sourcePath,compacted.sourceSha256,()=>{},compacted,f.keyPath);
 await assert.rejects(stat(duplicatePath),{code:'ENOENT'});
});
test('seals reject changed normalized/TOC bytes, source/plan identity, unsupported policy and missing or wrong key',async t=>{
 const f=await fixture(t),result=await compactSourceArchive(f.options),r=result.receipt;
 for(const path of [r.membershipPath,r.tocPath]){const bytes=await readFile(path);await writeFile(path,'changed');await assert.rejects(validatePublication(r,f.keyPath),/hash mismatch/);await writeFile(path,bytes);}
 for(const changed of [{...r,sourceUrl:'https://example.com/other.json'},{...r,sourceDate:new Date(Date.parse(r.sourceDate)+86400000).toISOString().slice(0,10)},{...r,plans:[{...r.plans[0],planId:'222222222'}]}])await assert.rejects(validatePublication(changed,f.keyPath));
 await assert.rejects(validatePublication(r,join(f.keyDir,'missing')));
 const wrong=join(f.keyDir,'wrong');await createSourceProofKey(wrong);await assert.rejects(validatePublication(r,wrong),/authentication mismatch/);
 const proof=JSON.parse(await readFile(r.sourceArchive!.proofPath,'utf8'));proof.body.extraction.validation.policy='unsupported';await writeFile(r.sourceArchive!.proofPath,JSON.stringify(proof));
 await assert.rejects(validatePublication({...r,sourceArchive:{...r.sourceArchive!,proofSha256:await sha256(r.sourceArchive!.proofPath)}},f.keyPath));
});
test('crash after durable seal leaves raw intact and resumes without manufacturing new acceptance',async t=>{
 const f=await fixture(t);
 await assert.rejects(compactSourceArchive({...f.options,afterSeal(){throw new Error('simulated crash');}}),/simulated crash/);
 assert.ok(await stat(f.receipt.sourcePath));
 const sealed=receiptSchema.parse(JSON.parse(await readFile(f.options.receiptPath,'utf8')));assert.ok(sealed.sourceArchive);
 const proofBefore=await readFile(sealed.sourceArchive.proofPath,'utf8');
 const result=await compactSourceArchive(f.options);assert.equal(result.state,'compacted');assert.equal(await readFile(sealed.sourceArchive.proofPath,'utf8'),proofBefore);
});
test('unsealed missing raw, rejected extraction, changed raw and shared references never authorize deletion',async t=>{
 const missing=await fixture(t);await rm(missing.receipt.sourcePath);await assert.rejects(compactSourceArchive(missing.options));
 const rejected=await fixture(t);const extraction=JSON.parse(await readFile(join(rejected.dir,'extraction.json'),'utf8'));extraction.validation.jsonEof=false;await writeFile(join(rejected.dir,'extraction.json'),JSON.stringify(extraction));await assert.rejects(compactSourceArchive(rejected.options));assert.ok(await stat(rejected.receipt.sourcePath));
 const changed=await fixture(t);await assert.rejects(compactSourceArchive({...changed.options,async afterSeal(){await writeFile(changed.receipt.sourcePath,'changed raw');}}));assert.ok(await stat(changed.receipt.sourcePath));
 const shared=await fixture(t),other=join(shared.root,'other-publication.json');await writeFile(other,JSON.stringify(shared.receipt));
 assert.equal((await compactSourceArchive({...shared.options,retainedReceiptPaths:[other]})).state,'retained_shared_raw');assert.ok(await stat(shared.receipt.sourcePath));
 await assert.rejects(compactSourceArchive({...shared.options,ownedRunRoot:join(shared.root,'different')}));
});
test('disconnect or directory replacement after sealing preserves raw and cannot write to replacement paths',async t=>{
 const f=await fixture(t);let online=true;
 await assert.rejects(compactSourceArchive({...f.options,afterSeal(){online=false;},guard(){if(!online)throw new Error('ssd_disconnected');}}),/ssd_disconnected/);assert.ok(await stat(f.receipt.sourcePath));
 const replaced=await fixture(t),old=replaced.dir+'-old';
 await assert.rejects(compactSourceArchive({...replaced.options,async afterSeal(){await rename(replaced.dir,old);await mkdir(replaced.dir);await writeFile(join(replaced.dir,'unrelated'),'preserve');}}));
 assert.equal(await readFile(join(replaced.dir,'unrelated'),'utf8'),'preserve');assert.ok(await stat(join(old,'source.json.gz')));
});
test('every durable compaction crash boundary resumes with retained normalized and TOC evidence',async t=>{
 for(const phase of ['proof_durable','receipt_durable','removal_manifest_durable','raw_removed'] as const){
  const f=await fixture(t);await assert.rejects(compactSourceArchive({...f.options,fault(at){if(at===phase)throw new Error('injected crash');}}),/injected crash/);
  const result=await compactSourceArchive(f.options);assert.ok(['compacted','already_compacted'].includes(result.state));
  await validatePublication(result.receipt,f.keyPath);await assert.rejects(stat(f.receipt.sourcePath),{code:'ENOENT'});
 }
});
test('rejected-source cleanup never creates acceptance and refuses prepared, shared, changed or disconnected sources',async t=>{
 const {reclaimRejectedSource}=await import('../scripts/lib/rejected-source-cleanup');
 const rejected=async()=>{const f=await fixture(t);await rm(f.options.receiptPath);return f;};
 const options=(f:Awaited<ReturnType<typeof fixture>>)=>({directory:f.dir,ownedRunRoot:f.options.ownedRunRoot,reason:'Membership limit exceeded',guard:()=>{},retainedReceiptPaths:[] as string[]});
 const f=await rejected();await reclaimRejectedSource(options(f));await assert.rejects(stat(f.receipt.sourcePath),{code:'ENOENT'});await assert.rejects(validatePublication(f.receipt,f.keyPath));
 assert.match(await readFile(join(f.dir,'rejected-source-retention.json'),'utf8'),/never publication evidence/);
 const prepared=await fixture(t);await assert.rejects(reclaimRejectedSource(options(prepared)),/must be retained/);assert.ok(await stat(prepared.receipt.sourcePath));
 const shared=await rejected(),path=join(shared.root,'other.json');await writeFile(path,JSON.stringify(shared.receipt));await assert.rejects(reclaimRejectedSource({...options(shared),retainedReceiptPaths:[path]}),/referenced/);
 const changed=await rejected();await assert.rejects(reclaimRejectedSource({...options(changed),beforeRemoval:async()=>{await writeFile(changed.receipt.sourcePath,'changed');}}),/changed/);assert.ok(await stat(changed.receipt.sourcePath));
 const disconnected=await rejected();let online=true;await assert.rejects(reclaimRejectedSource({...options(disconnected),guard(){if(!online)throw new Error('offline');},beforeRemoval:async()=>{online=false;}}),/offline/);assert.ok(await stat(disconnected.receipt.sourcePath));
});

test('derived exact NPI serving preserves a sealed original receipt and rejects unrelated source changes',async t=>{
 const f=await fixture(t);await compactSourceArchive(f.options);
 const before=await readFile(f.options.receiptPath,'utf8');const original=await validatePublication(JSON.parse(before),f.keyPath);
 const {deriveCompactPublication}=await import('../scripts/lib/compact-serving');
 const derived=await deriveCompactPublication(original,f.options.receiptPath,()=>{},f.keyPath);
 assert.equal(derived.receipt.serving?.npiCount,1);assert.equal(await readFile(f.options.receiptPath,'utf8'),before);
 assert.deepEqual(derived.receipt.sourceArchive,original.sourceArchive);
 assert.equal((await deriveCompactPublication(original,f.options.receiptPath,()=>{},f.keyPath)).receiptPath,derived.receiptPath);
 await assert.rejects(validatePublication({...derived.receipt,membershipSha256:'0'.repeat(64)},f.keyPath));
});
