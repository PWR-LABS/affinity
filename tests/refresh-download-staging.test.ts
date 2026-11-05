import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,readFile,writeFile,readdir,stat,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {downloadOwnedFile,recoverDownloadStages,recoverCompletedDownload,type DownloadJournal} from '../scripts/lib/download-staging';
import {anthemTocArchiveKey} from '../scripts/lib/anthem-large-toc';
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'affinity-download-journal-')));t.after(()=>rm(root,{recursive:true,force:true}));const archiveRoot=join(root,'archive'),directory=join(root,'state');await mkdir(archiveRoot);await mkdir(directory,{mode:0o700});
 const journal:DownloadJournal={archiveRoot,directory,volumeUUID:'expected-volume'};return {root,journal,path:join(archiveRoot,'source.json.gz')};
}
const url='https://example.com/rate?Signature=private-transport';
const response=(body:string,headers:Record<string,string>={etag:'"one"'})=>(async()=>new Response(body,{headers})) as typeof fetch;
async function interrupted(t:{after:(f:()=>Promise<void>)=>void},checkpoint=false){
 const f=await fixture(t);let online=true,n=0;
 const content=checkpoint?Buffer.alloc(16_000_000,97):Buffer.from('owned-prefix');
 const stream=new ReadableStream<Uint8Array>({pull(c){if(n++===0)c.enqueue(content);else{online=false;c.enqueue(Buffer.from('unwritten'));c.close();}}},{highWaterMark:0});
 await assert.rejects(downloadOwnedFile({...f,url,maxBytes:content.length+100,timeoutMs:1000,guard:()=>{if(!online)throw new Error('disconnected');},fetcher:(async()=>new Response(stream)) as typeof fetch}),/disconnected/);
 const name=(await readdir(f.journal.directory)).find(n=>n.endsWith('.json'))!;assert.ok(name);const record=JSON.parse(await readFile(join(f.journal.directory,name),'utf8'));
 assert.equal(record.completedBytes,checkpoint?content.length:0);assert.equal(record.phase,'interrupted');assert.equal(record.source,'https://example.com/rate');
 return {...f,name,record,content,partial:f.path+'.'+record.id+'.partial'};
}
test('completed downloads are immutable and can recover a lost caller receipt with a current validator',async t=>{
 const f=await fixture(t);const receipt=await downloadOwnedFile({...f,url,maxBytes:100,timeoutMs:1000,guard:()=>{},fetcher:response('complete')});
 assert.equal(receipt.bytes,8);assert.equal(await readFile(f.path,'utf8'),'complete');assert.equal((await readdir(f.journal.directory)).filter(n=>n.endsWith('.json')).length,0);
 assert.deepEqual(await recoverCompletedDownload({...f,url,etag:'"one"',bytes:8,guard:()=>{}}),receipt);
 assert.equal(await recoverCompletedDownload({...f,url,etag:'"changed"',bytes:8,guard:()=>{}}),undefined);
 assert.equal(await recoverCompletedDownload({...f,url:url+'&network=another',etag:'"one"',bytes:8,guard:()=>{}}),undefined);
 await assert.rejects(downloadOwnedFile({...f,url,maxBytes:100,timeoutMs:1000,guard:()=>{},fetcher:response('replacement')}),/occupied/);assert.equal(await readFile(f.path,'utf8'),'complete');
 await writeFile(f.path,'modified');await assert.rejects(recoverCompletedDownload({...f,url,etag:'"one"',bytes:8,guard:()=>{}}),/bytes changed/);
});
test('an interrupted download is reclaimed after reconnect even when the next run uses another directory',async t=>{
 const f=await interrupted(t);await assert.rejects(stat(f.path));assert.equal(await readFile(f.partial,'utf8'),'owned-prefix');
 await assert.rejects(recoverDownloadStages(f.journal,()=>{throw new Error('still disconnected');}),/disconnected/);await stat(f.partial);
 assert.deepEqual(await recoverDownloadStages(f.journal,()=>{}),{recovered:1,active:0});await assert.rejects(stat(f.partial));const report=JSON.parse(await readFile(join(f.journal.directory,'recovered',f.name),'utf8'));assert.equal(report.state,'partial_removed');assert.equal(report.bytes,12);assert.equal(report.finalFilePreserved,true);
 const next=join(f.journal.archiveRoot,'next-run');await mkdir(next);const r=await downloadOwnedFile({url,path:join(next,'source'),journal:f.journal,maxBytes:100,timeoutMs:1000,guard:()=>{},fetcher:response('new-complete')});assert.equal(r.bytes,12);
});
test('network and cap failures clean their own partials immediately while preserving unrelated files',async t=>{
 const f=await fixture(t);await writeFile(join(f.journal.archiveRoot,'other.partial'),'unrelated');
 await assert.rejects(downloadOwnedFile({...f,url,maxBytes:3,timeoutMs:1000,guard:()=>{},fetcher:response('too large')}),/source_size_limit/);
 assert.deepEqual(await readdir(f.journal.archiveRoot),['other.partial']);assert.equal((await readdir(f.journal.directory)).filter(n=>n.endsWith('.json')).length,0);
 let chunks=0;
 const broken=new ReadableStream<Uint8Array>({pull(c){if(chunks++===0)c.enqueue(Buffer.from('written-prefix'));else c.error(new Error('connection reset'));}},{highWaterMark:0});
 await assert.rejects(downloadOwnedFile({...f,url,maxBytes:100,timeoutMs:1000,guard:()=>{},fetcher:(async()=>new Response(broken)) as typeof fetch}),/connection reset/);
 assert.deepEqual(await readdir(f.journal.archiveRoot),['other.partial']);assert.equal((await readdir(f.journal.directory)).filter(n=>n.endsWith('.json')).length,0);
 assert.equal(await readFile(join(f.journal.archiveRoot,'other.partial'),'utf8'),'unrelated');
});
test('changed partial bytes, replaced inodes, wrong volume and directory replacements are never reclaimed',async t=>{
 const f=await interrupted(t,true);await assert.rejects(recoverDownloadStages({...f.journal,volumeUUID:'other'},()=>{}),/ownership mismatch/);
 await writeFile(f.partial,Buffer.alloc(f.content.length,98));await assert.rejects(recoverDownloadStages(f.journal,()=>{}),/bytes changed/);await stat(f.partial);
 await writeFile(f.partial,f.content);await rename(f.partial,f.partial+'.saved');await writeFile(f.partial,f.content);await assert.rejects(recoverDownloadStages(f.journal,()=>{}),/file changed/);await stat(f.partial);
 await rm(f.partial);await rename(f.partial+'.saved',f.partial);const original=f.journal.archiveRoot+'.original';await rename(f.journal.archiveRoot,original);await mkdir(f.journal.archiveRoot);await writeFile(join(f.journal.archiveRoot,'sentinel'),'keep');await assert.rejects(recoverDownloadStages(f.journal,()=>{}),/directory changed/);assert.equal(await readFile(join(f.journal.archiveRoot,'sentinel'),'utf8'),'keep');
});
test('live writers, promoted final files and unjournaled partials remain untouched',async t=>{
 const f=await interrupted(t),recordPath=join(f.journal.directory,f.name);f.record.phase='downloading';await writeFile(recordPath,JSON.stringify(f.record),{mode:0o600});
 assert.deepEqual(await recoverDownloadStages(f.journal,()=>{}),{recovered:0,active:1});await stat(f.partial);
 f.record.phase='interrupted';await writeFile(recordPath,JSON.stringify(f.record),{mode:0o600});await rename(f.partial,f.path);await writeFile(join(f.journal.archiveRoot,'legacy.partial'),'unknown');
 assert.deepEqual(await recoverDownloadStages(f.journal,()=>{}),{recovered:1,active:0});assert.equal(await readFile(f.path,'utf8'),'owned-prefix');assert.equal(await readFile(join(f.journal.archiveRoot,'legacy.partial'),'utf8'),'unknown');
});
test('a replaced download parent cannot receive activation or cleanup',async t=>{
 const f=await fixture(t);let n=0;const moved=f.journal.archiveRoot+'.moved';
 const body=new ReadableStream<Uint8Array>({async pull(c){if(n++===0)c.enqueue(Buffer.from('owned'));else{await rename(f.journal.archiveRoot,moved);await mkdir(f.journal.archiveRoot);await writeFile(f.path,'replacement');c.enqueue(Buffer.from('tail'));c.close();}}},{highWaterMark:0});
 await assert.rejects(downloadOwnedFile({...f,url,maxBytes:100,timeoutMs:1000,guard:()=>{},fetcher:(async()=>new Response(body)) as typeof fetch}),/directory changed/);assert.equal(await readFile(f.path,'utf8'),'replacement');assert.equal((await readdir(moved)).filter(n=>n.endsWith('.partial')).length,1);
});
test('TOC archive versions bind ETags separately from signing query parameters',()=>{
 const source='https://example.com/toc';assert.equal(anthemTocArchiveKey(source+'?Signature=a','one'),anthemTocArchiveKey(source+'?Signature=b','one'));
 assert.notEqual(anthemTocArchiveKey(source,'one'),anthemTocArchiveKey(source,'two'));
 assert.notEqual(anthemTocArchiveKey(source+'?Signature=signed','one'),anthemTocArchiveKey(source+'?Signature=signed','two'));
 assert.notEqual(anthemTocArchiveKey(source,null,'first'),anthemTocArchiveKey(source,null,'second'));
 assert.notEqual(anthemTocArchiveKey(source,'','first'),anthemTocArchiveKey(source,'','second'));
});
test('a crash after file promotion can recover the complete download without accepting JSON evidence',async t=>{
 const f=await fixture(t);await assert.rejects(downloadOwnedFile({...f,url,maxBytes:100,timeoutMs:1000,guard:()=>{},fetcher:response('complete'),fault:phase=>{if(phase==='promoted')throw new Error('lost caller receipt');}}),/lost caller receipt/);
 assert.equal(await readFile(f.path,'utf8'),'complete');const receipt=await recoverCompletedDownload({...f,url,etag:'"one"',bytes:8,guard:()=>{}});assert.equal(receipt?.bytes,8);assert.equal('validation' in receipt!,false);
});
