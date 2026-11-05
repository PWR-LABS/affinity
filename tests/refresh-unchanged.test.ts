import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {conditionalSourceUnchanged,reclaimDuplicateDownload,sourceValidator} from '../scripts/lib/unchanged-source';
import {sha256} from '../src/lib/tic/publication';
test('HEAD-incompatible sources can prove unchanged with a conditional GET; 200 never proves unchanged',async()=>{
 const fetcher=(async(_url:unknown,init:RequestInit)=>{assert.equal(new Headers(init.headers).get('If-None-Match'),'"version"');return new Response(null,{status:304});}) as typeof fetch;
 assert.equal(await conditionalSourceUnchanged('https://example.com/data','"version"',fetcher),true);
 assert.equal(await conditionalSourceUnchanged('https://example.com/data','"version"',(async()=>new Response('new content')) as typeof fetch),false);
 assert.equal(await conditionalSourceUnchanged('https://example.com/data','"version"',(async()=>{throw new Error('conditional requests unsupported');}) as typeof fetch),false);
});
test('duplicate reclamation preserves the original and manifest, and refuses changed bytes',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'affinity-duplicate-')));const original=join(dir,'original'),duplicate=join(dir,'source');
 try{
  await writeFile(original,'same');await writeFile(duplicate,'changed');const hash=await sha256(original);
  await writeFile(join(dir,'download.json'),JSON.stringify({sha256:hash}));
  await assert.rejects(reclaimDuplicateDownload(duplicate,original,hash,()=>{}),/hash mismatch/);
  await stat(duplicate);await writeFile(duplicate,'same');
  await assert.rejects(reclaimDuplicateDownload(duplicate,original,hash,()=>{throw new Error('disconnected');}),/disconnected/);
  await reclaimDuplicateDownload(duplicate,original,hash,()=>{});
  await assert.rejects(stat(duplicate));assert.equal(await readFile(original,'utf8'),'same');
  assert.equal(JSON.parse(await readFile(join(dir,'retention.json'),'utf8')).sha256,hash);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('HEAD transport errors still attempt conditional GET, while changed or failed GET cannot reuse a validator',async()=>{
 let gets=0;
 const failedHead=(async(_url:unknown,init:RequestInit)=>{if(init.method==='HEAD')throw new Error('HEAD timed out');gets++;return new Response(null,{status:304});}) as typeof fetch;
 assert.equal(await sourceValidator('https://example.com/data','"old"',failedHead),'"old"');assert.equal(gets,1);
 assert.equal(await sourceValidator('https://example.com/data',undefined,failedHead),null);assert.equal(gets,1);
 const changed=(async(_url:unknown,init:RequestInit)=>init.method==='HEAD'?new Response(null,{headers:{etag:'"new"'}}):new Response('changed')) as typeof fetch;
 assert.equal(await sourceValidator('https://example.com/data','"old"',changed),'"new"');
 assert.equal(await sourceValidator('https://example.com/data','"old"',(async()=>{throw new Error('offline');}) as typeof fetch),null);
});
