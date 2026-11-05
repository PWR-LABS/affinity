import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { superviseRefresh } from '../scripts/lib/refresh-supervisor';
import { lockRun } from '../scripts/lib/refresh-runtime';

test('abrupt worker exit records failure but cannot overwrite another run checkpoint',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 try{
  const script=`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,state:'running',results:[{state:'published'}]}));process.exit(7)`;
  assert.equal(await superviseRefresh(['-e',script,path],path),7);
  let status=JSON.parse(await readFile(path,'utf8'));assert.equal(status.state,'failed');assert.equal(status.exitCode,7);assert.equal(status.results[0].state,'published');
  await writeFile(path,JSON.stringify({pid:process.pid,state:'running'}));
  await superviseRefresh(['-e','process.exit(8)'],path);
  status=JSON.parse(await readFile(path,'utf8'));assert.equal(status.state,'running');assert.equal(status.pid,process.pid);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('killed publisher releases OS mutex and concurrent stale takeover has exactly one owner',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-mutex-'));
 const source=new URL('../scripts/lib/refresh-runtime.ts',import.meta.url).href;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`import {lockRun} from ${JSON.stringify(source)};await lockRun(process.argv[1]);console.log('ready');setInterval(()=>{},1000);`,dir],{stdio:['ignore','pipe','pipe']});
 try{
  await once(child.stdout,'data'); const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const contenders=await Promise.allSettled([lockRun(dir),lockRun(dir)]);
  assert.equal(contenders.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(contenders.filter(r=>r.status==='rejected').length,1);
  for(const result of contenders)if(result.status==='fulfilled'){await result.value();await result.value();}
  await(await lockRun(dir))();
 }finally{child.kill('SIGKILL');await rm(dir,{recursive:true,force:true});}
});

test('independent deadline interrupts a blocked worker and its helper without discarding progress',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json'),escaped=join(dir,'escaped');
 try{
  const script=`
    require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,state:'running',results:[{state:'published'}]}));
    process.on('SIGTERM',()=>{});
    require('child_process').spawn(process.execPath,['-e',"setTimeout(()=>require('fs').writeFileSync(process.argv[1],'escaped'),1600)",process.argv[2]],{stdio:'ignore'});
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
  `;
  const started=performance.now();
  assert.equal(await superviseRefresh(['-e',script,path,escaped],path,{deadlineMs:600,graceMs:100}),124);
  assert.ok(performance.now()-started<1500);
  const status=JSON.parse(await readFile(path,'utf8'));
  assert.equal(status.reason,'worker_deadline');assert.equal(status.state,'deferred');assert.equal(status.results[0].state,'published');
  await new Promise(resolve=>setTimeout(resolve,1700));
  await assert.rejects(readFile(escaped),{code:'ENOENT'});
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('storage preflight has its own deadline; readiness cancels only that deadline',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 const prefix=`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,state:'running',current:{phase:'storage_preflight'}}));`;
 try{
  assert.equal(await superviseRefresh(['-e',prefix+`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0)`,path],path,{preflightMs:300,deadlineMs:2000,graceMs:50}),124);
  assert.equal(JSON.parse(await readFile(path,'utf8')).reason,'storage_preflight_timeout');
  assert.equal(await superviseRefresh(['-e',prefix+`process.send({type:'refresh_storage_ready'});setTimeout(()=>process.exit(0),500)`,path],path,{preflightMs:300,deadlineMs:2000,graceMs:50}),0);
  assert.equal(await superviseRefresh(['-e',prefix+`process.send({type:'refresh_storage_ready'});setInterval(()=>{},1000)`,path],path,{preflightMs:300,deadlineMs:700,graceMs:50}),124);
  assert.equal(JSON.parse(await readFile(path,'utf8')).reason,'worker_deadline');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('deadline cannot overwrite another publisher checkpoint',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 try{
  await writeFile(path,JSON.stringify({pid:process.pid,state:'running',sentinel:'other publisher'}));
  assert.equal(await superviseRefresh(['-e','setInterval(()=>{},1000)'],path,{deadlineMs:200,graceMs:50}),124);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{pid:process.pid,state:'running',sentinel:'other publisher'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
