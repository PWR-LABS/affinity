import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,lstat,readdir,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,basename} from 'node:path';import {gzipSync} from 'node:zlib';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {preparePublication} from '../scripts/tic-refresh';
import {compressNormalizedEvidence,compressionWorthInstalling} from '../scripts/lib/normalized-compression';
import {compactSourceArchive} from '../scripts/lib/source-compaction';
import {createSourceProofKey} from '../src/lib/tic/source-proof';
import {sha256,validatePublication} from '../src/lib/tic/publication';
const mac={skip:process.platform!=='darwin'};
test('large-file extent repacking is not classified as material compression',()=>{
 assert.equal(compressionWorthInstalling(BigInt(921788928),BigInt(922845184),BigInt(921792512)),false);
 assert.equal(compressionWorthInstalling(BigInt(11117250),BigInt(11120640),BigInt(450560)),true);
 assert.equal(compressionWorthInstalling(BigInt(11117250),BigInt(450560),BigInt(454656)),false);
});
async function fixture(sealed=true){
 const root=await realpath(await mkdtemp(join(tmpdir(),'affinity-normalized-'))),directory=join(root,'source');await mkdir(directory);
 const keyPath=join(root,'key');await createSourceProofKey(keyPath);
 const sourcePath=join(directory,'source.json.gz'),tocPath=join(directory,'toc.json'),sourceUrl='https://example.com/complete.json.gz';
 await writeFile(sourcePath,gzipSync(JSON.stringify({reporting_entity_name:'Complete fixture',last_updated_on:new Date(Date.now()-86400000).toISOString().slice(0,10),version:'2.0.0',in_network:[{negotiated_rates:[{provider_groups:[{npi:Array.from({length:2000},(_,i)=>1234567890+i),tin:{type:'EIN',value:'111111111'}}]}]}]})));
 await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_name:'Exact plan',plan_id_type:'EIN',plan_id:'111111111',plan_market_type:'group'}]}]}));
 await writeFile(join(directory,'download.json'),JSON.stringify({bytes:(await lstat(sourcePath)).size,sha256:await sha256(sourcePath)}));
 const receiptPath=join(directory,'publication.json');await preparePublication({sourcePath,sourceUrl,tocPath,tocUrl:'https://example.com/toc',directory,guard:()=>{},compact:true,disk:{scratchRoot:directory}});
 if(sealed)await compactSourceArchive({receiptPath,ownedRunRoot:root,guard:()=>{},retainedReceiptPaths:[],keyPath});
 const receiptText=await readFile(receiptPath,'utf8'),receipt=JSON.parse(receiptText);
 const options={receiptPath,root,keyPath,guard:()=>{},reserve:async()=>{}};
 return {root,directory,receiptPath,receiptText,receipt,options,stages:async()=>(await readdir(directory)).filter(n=>n.startsWith('.normalized-compression-'))};
}
test('transparent compression preserves authenticated and raw-backed receipt bytes, full rows and replay',mac,async()=>{
 for(const sealed of [false,true]){const f=await fixture(sealed);try{
  const result=await compressNormalizedEvidence(f.options);assert.equal(result.state,'compressed');
  if(result.state==='compressed')assert.ok(result.afterAllocatedBytes<result.beforeAllocatedBytes);
  assert.equal(await readFile(f.receiptPath,'utf8'),f.receiptText);await validatePublication(f.receipt,f.options.keyPath);
  if(!sealed)assert.equal(await sha256(f.receipt.sourcePath),f.receipt.sourceSha256);
  assert.equal((await compressNormalizedEvidence(f.options)).state,'already_space_efficient');assert.deepEqual(await f.stages(),[]);
 }finally{await rm(f.root,{recursive:true,force:true});}}
});
test('changed candidate bytes are rejected without replacing the source',mac,async()=>{
 const f=await fixture();try{
  const before=await lstat(f.receipt.membershipPath);
  await assert.rejects(compressNormalizedEvidence({...f.options,copy:async(source,dir)=>{await writeFile(join(dir,basename(source)),'bad copy');}}),/candidate bytes differ/);
  assert.equal((await lstat(f.receipt.membershipPath)).ino,before.ino);await validatePublication(f.receipt,f.options.keyPath);assert.deepEqual(await f.stages(),[]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('the retained manual members.ndjson filename has identical verification and compression guarantees',mac,async()=>{
 const f=await fixture(false);try{
  const path=join(f.directory,'members.ndjson');await rename(f.receipt.membershipPath,path);f.receipt.membershipPath=path;await writeFile(f.receiptPath,JSON.stringify(f.receipt));
  const before=await readFile(f.receiptPath,'utf8');assert.equal((await compressNormalizedEvidence(f.options)).state,'compressed');
  assert.equal(await readFile(f.receiptPath,'utf8'),before);await validatePublication(f.receipt,f.options.keyPath);assert.equal(await sha256(f.receipt.sourcePath),f.receipt.sourceSha256);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('storage loss before replacement preserves original bytes and recovers only the owned stage',mac,async()=>{
 const f=await fixture();let available=true;try{
  const before=await lstat(f.receipt.membershipPath),guard=()=>{if(!available)throw Error('ssd_disconnected');};
  await assert.rejects(compressNormalizedEvidence({...f.options,guard,checkpoint:phase=>{if(phase==='after_copy'){available=false;throw Error('ssd_disconnected');}}}),/ssd_disconnected/);
  assert.equal((await lstat(f.receipt.membershipPath)).ino,before.ino);assert.equal((await f.stages()).length,1);await validatePublication(f.receipt,f.options.keyPath);
  available=true;assert.equal((await compressNormalizedEvidence({...f.options,guard})).state,'compressed');assert.deepEqual(await f.stages(),[]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('interruption after atomic replacement leaves valid evidence and replay recovers the journal',mac,async()=>{
 const f=await fixture();try{
  await assert.rejects(compressNormalizedEvidence({...f.options,checkpoint:phase=>{if(phase==='after_replace')throw Object.assign(Error('simulated process loss'),{preserveStage:true});}}),/simulated process loss/);
  await validatePublication(f.receipt,f.options.keyPath);assert.equal(await readFile(f.receiptPath,'utf8'),f.receiptText);assert.equal((await f.stages()).length,1);
  assert.equal((await compressNormalizedEvidence(f.options)).state,'already_space_efficient');assert.deepEqual(await f.stages(),[]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('active owners and unexpected stage contents are preserved for review',mac,async()=>{
 const f=await fixture();try{
  await assert.rejects(compressNormalizedEvidence({...f.options,checkpoint:phase=>{if(phase==='before_copy')throw Object.assign(Error('simulated process loss'),{preserveStage:true});}}));
  const stage=join(f.directory,(await f.stages())[0]),path=join(stage,'journal.json'),journal=JSON.parse(await readFile(path,'utf8'));
  await writeFile(path,JSON.stringify({...journal,pid:process.ppid}));await assert.rejects(compressNormalizedEvidence(f.options),/owner remains active/);
  await writeFile(path,JSON.stringify(journal));await writeFile(join(stage,'unrelated.txt'),'preserve');
  await assert.rejects(compressNormalizedEvidence(f.options),/Unrecognized/);assert.equal(await readFile(join(stage,'unrelated.txt'),'utf8'),'preserve');await validatePublication(f.receipt,f.options.keyPath);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('symlink candidates and changed original files cannot replace accepted evidence',mac,async()=>{
 const f=await fixture();try{
  const outside=join(f.root,'unrelated.txt');await writeFile(outside,'preserve');
  await assert.rejects(compressNormalizedEvidence({...f.options,copy:async(source,dir)=>{await symlink(outside,join(dir,basename(source)));}}),/Unsafe/);
  assert.equal(await readFile(outside,'utf8'),'preserve');await validatePublication(f.receipt,f.options.keyPath);
 }finally{await rm(f.root,{recursive:true,force:true});}
 const f2=await fixture();try{
  await assert.rejects(compressNormalizedEvidence({...f2.options,checkpoint:phase=>{if(phase==='after_copy')require('node:fs').writeFileSync(f2.receipt.membershipPath,'external change');}}),/source changed/);
  assert.equal(await readFile(f2.receipt.membershipPath,'utf8'),'external change');
 }finally{await rm(f2.root,{recursive:true,force:true});}
});
test('space admission failure creates no stage and preserves the original',mac,async()=>{
 const f=await fixture();try{
  const before=await lstat(f.receipt.membershipPath);let reservation=0;
  await assert.rejects(compressNormalizedEvidence({...f.options,reserve:async bytes=>{reservation=bytes;throw Error('ssd_free_space_reservation');}}),/ssd_free_space_reservation/);
  assert.ok(reservation>before.size);assert.equal((await lstat(f.receipt.membershipPath)).ino,before.ino);assert.deepEqual(await f.stages(),[]);await validatePublication(f.receipt,f.options.keyPath);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('an orphaned copy writer prevents stage reclamation until its handle closes',mac,async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined;try{
  await assert.rejects(compressNormalizedEvidence({...f.options,checkpoint:phase=>{if(phase==='before_copy')throw Object.assign(Error('simulated process loss'),{preserveStage:true});}}));
  const stage=join(f.directory,(await f.stages())[0]),journalPath=join(stage,'journal.json'),j=JSON.parse(await readFile(journalPath,'utf8'));
  await writeFile(journalPath,JSON.stringify({...j,pid:2147483647}));
  child=spawn(process.execPath,['-e',"require('node:fs').openSync(process.argv[1],'w'); process.stdout.write('ready'); setInterval(()=>{},1000)",join(stage,basename(f.receipt.membershipPath))],{stdio:['ignore','pipe','pipe']});
  await once(child.stdout!,'data');await assert.rejects(compressNormalizedEvidence(f.options),/writer remains open/);assert.equal((await f.stages()).length,1);
  const exited=once(child,'close');child.kill('SIGTERM');await exited;child=undefined;
  assert.equal((await compressNormalizedEvidence(f.options)).state,'compressed');assert.deepEqual(await f.stages(),[]);await validatePublication(f.receipt,f.options.keyPath);
 }finally{child?.kill('SIGKILL');await rm(f.root,{recursive:true,force:true});}
});

test('SIGKILL before and after atomic replacement recovers durable stages without changing receipt identity',mac,async()=>{
 const implementation=new URL('../scripts/lib/normalized-compression.ts',import.meta.url).href;
 for(const phase of ['before_replace','after_replace']){
  const f=await fixture();let child:ReturnType<typeof spawn>|undefined;
  try{
   const before=await lstat(f.receipt.membershipPath);
   const script=`import {compressNormalizedEvidence} from ${JSON.stringify(implementation)};
    await compressNormalizedEvidence({receiptPath:process.argv[1],root:process.argv[2],keyPath:process.argv[3],
     guard(){},async reserve(){},checkpoint(phase){if(phase===process.argv[4]){
      process.send({phase});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
     }}});`;
   child=spawn(process.execPath,['--import','tsx','--import','./tests/fixture-clock.ts','--input-type=module','-e',script,f.receiptPath,f.root,f.options.keyPath,phase],{stdio:['ignore','ignore','pipe','ipc']});
   const errors:string[]=[];child.stderr!.on('data',chunk=>errors.push(String(chunk)));
   const exited=once(child,'exit');
   await Promise.race([once(child,'message'),exited.then(([code])=>{throw Error(`Compression exited before checkpoint (${code}): ${errors.join('')}`);})]);
   child.kill('SIGKILL');await exited;child=undefined;
   assert.equal(await readFile(f.receiptPath,'utf8'),f.receiptText);await validatePublication(f.receipt,f.options.keyPath);
   assert.equal((await lstat(f.receipt.membershipPath)).ino===before.ino,phase==='before_replace');
   assert.equal((await f.stages()).length,1);
   assert.equal((await compressNormalizedEvidence(f.options)).state,phase==='before_replace'?'compressed':'already_space_efficient');
   assert.deepEqual(await f.stages(),[]);assert.equal(await readFile(f.receiptPath,'utf8'),f.receiptText);
  }finally{child?.kill('SIGKILL');await rm(f.root,{recursive:true,force:true});}
 }
});
