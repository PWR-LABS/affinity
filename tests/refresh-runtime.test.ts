import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadFile, lockRun, sourceKey, Deferred } from '../scripts/lib/refresh-runtime';
const fetcher = (body: ReadableStream<Uint8Array>) => (async()=>new Response(body)) as typeof fetch;
test('disconnect mid-transfer leaves only partial data; reconnect restarts and validates complete bytes', async()=>{
  const dir = await realpath(await mkdtemp(join(tmpdir(),'affinity-disconnect-')));
  try {
    const path = join(dir,'rate.json'); let online = true;
    const guard = ()=>{if(!online) throw new Deferred('ssd_disconnected');};
    let n=0;
    const body = new ReadableStream<Uint8Array>({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode('half'));else {online=false;c.enqueue(new TextEncoder().encode('broken'));c.close();}}});
    await assert.rejects(downloadFile('https://example.com/data',path,100,guard,fetcher(body)),/ssd_disconnected/);
    await assert.rejects(stat(path));
    online=true;
    const complete = new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('complete'));c.close();}});
    const result=await downloadFile('https://example.com/data',path,100,guard,fetcher(complete));
    assert.equal(result.bytes,8); assert.equal(await readFile(path,'utf8'),'complete');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('download cap rejects unbounded response and never activates a final file',async()=>{
 const dir=await realpath(await mkdtemp(join(tmpdir(),'affinity-cap-')));
 try { const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(101));c.close();}});
 await assert.rejects(downloadFile('https://example.com/data',join(dir,'file'),100,()=>{},fetcher(body)),/source_size_limit/);
 await assert.rejects(stat(join(dir,'file')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('run lock rejects overlap and signed query churn preserves object identity',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-lock-'));
 try {const unlock=await lockRun(dir);await assert.rejects(lockRun(dir),/already_running/);await unlock();await(await lockRun(dir))();
 assert.equal(sourceKey('https://example.com/x?Signature=a'),sourceKey('https://example.com/x?Signature=b'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
