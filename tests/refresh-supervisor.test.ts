import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm,writeFile,lstat,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { superviseRefresh } from '../scripts/lib/refresh-supervisor';
import { lockRun } from '../scripts/lib/refresh-runtime';

test('abrupt worker exit records failure but cannot overwrite another run checkpoint',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 try{
  const script=`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,supervisionId:process.env.AFFINITY_REFRESH_SUPERVISION_ID,state:'running',results:[{state:'published'}]}));process.exit(7)`;
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
    require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,supervisionId:process.env.AFFINITY_REFRESH_SUPERVISION_ID,state:'running',results:[{state:'published'}]}));
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
 const prefix=`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,supervisionId:process.env.AFFINITY_REFRESH_SUPERVISION_ID,state:'running',current:{phase:'storage_preflight'}}));`;
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
 const unlock=await lockRun(dir);
 try{
  await writeFile(path,JSON.stringify({pid:process.pid,state:'running',sentinel:'other publisher'}));
  const sidecar=join(dir,'run.lock'),mutex=join(dir,'run-mutex.sqlite'),before=[await lstat(sidecar),await lstat(mutex)];
  assert.equal(await superviseRefresh(['-e','setInterval(()=>{},1000)'],path,{deadlineMs:200,graceMs:50}),124);
  assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{pid:process.pid,state:'running',sentinel:'other publisher'});
  assert.equal(await readFile(sidecar,'utf8'),String(process.pid));
  assert.deepEqual([await lstat(sidecar),await lstat(mutex)].map(s=>s.ino),before.map(s=>s.ino));
 }finally{await unlock();await rm(dir,{recursive:true,force:true});}
});

test('abnormal worker exit also terminates helpers in its dedicated process group',async()=>{
 for(const signalExit of [false,true]){
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json'),escaped=join(dir,'escaped');
 try{
  const script=`
   require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,supervisionId:process.env.AFFINITY_REFRESH_SUPERVISION_ID,state:'running',results:[{state:'published'}]}));
   const helper=require('child_process').spawn(process.execPath,['-e',
    "process.on('SIGTERM',()=>{});process.send('ready');setTimeout(()=>require('fs').writeFileSync(process.argv[1],'escaped'),700)",process.argv[2]],
    {stdio:['ignore','ignore','ignore','ipc']});
   helper.once('message',()=>${signalExit?"process.kill(process.pid,'SIGKILL')":'process.exit(7)'});
  `;
  assert.equal(await superviseRefresh(['-e',script,path,escaped],path),signalExit?1:7);
  await new Promise(resolve=>setTimeout(resolve,1000));
  await assert.rejects(readFile(escaped),{code:'ENOENT'});
  const status=JSON.parse(await readFile(path,'utf8'));
  assert.equal(status.state,'failed');assert.equal(status.results[0].state,'published');
  assert.equal(status.signal,signalExit?'SIGKILL':null);
 }finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('publisher takeover cannot race the supervisor checkpoint replacement',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 let release:(()=>Promise<void>)|undefined,takeover=false,excluded=false;
 const originalRead=fs.readFile;
 // Pause after the supervisor has read its worker's last checkpoint. A fresh
 // publisher must either be excluded or retain its checkpoint and PID sidecar.
 t.mock.method(fs,'readFile',async(...args:Parameters<typeof fs.readFile>)=>{
  const value=await originalRead(...args);
  if(args[0]===path&&!takeover&&!excluded){
   try{release=await lockRun(dir);}
   catch(e){if(!String(e).includes('publisher_already_running'))throw e;excluded=true;}
   if(release){takeover=true;await writeFile(path,JSON.stringify({pid:process.pid,state:'running',sentinel:'new publisher'}));}
  }
  return value;
 });
 try{
  const script=`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,supervisionId:process.env.AFFINITY_REFRESH_SUPERVISION_ID,state:'running'}));process.exit(7)`;
  assert.equal(await superviseRefresh(['-e',script,path],path),7);
  const status=JSON.parse(await originalRead(path,'utf8'));
  if(takeover){
   assert.equal(status.sentinel,'new publisher');assert.equal(status.state,'running');
   assert.equal(await originalRead(join(dir,'run.lock'),'utf8'),String(process.pid));
  }else{assert.ok(excluded);assert.equal(status.state,'failed');}
 }finally{t.mock.restoreAll();await release?.();await rm(dir,{recursive:true,force:true});}
});

test('pending termination preserves the surviving worker mutex, PID sidecar and checkpoint',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 const source=new URL('../scripts/lib/refresh-runtime.ts',import.meta.url).href;
 const kill=process.kill.bind(process);let group:number|undefined;
 // Model a kernel-blocked process that has not delivered either signal yet.
 t.mock.method(process,'kill',((pid:number,signal:NodeJS.Signals|number)=>{
  if(pid<0){group=pid;return true;}
  return kill(pid,signal);
 }) as typeof process.kill);
 try{
  const script=`import {lockRun} from ${JSON.stringify(source)};import {writeFileSync} from 'node:fs';await lockRun(process.argv[1]);writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,supervisionId:process.env.AFFINITY_REFRESH_SUPERVISION_ID,state:'running',results:[{state:'published'}]}));setInterval(()=>{},1000);`;
  assert.equal(await superviseRefresh(['--import','tsx','-e',script,dir,path],path,{deadlineMs:1000,graceMs:50}),124);
  assert.ok(group);
  const status=JSON.parse(await readFile(path,'utf8')),pid=-group;
  assert.equal(status.pid,pid);assert.equal(status.state,'running');assert.equal(status.results[0].state,'published');
  const sidecar=join(dir,'run.lock'),mutex=join(dir,'run-mutex.sqlite');
  const before=[await lstat(sidecar),await lstat(mutex)];
  assert.equal(await readFile(sidecar,'utf8'),String(pid));await assert.rejects(lockRun(dir),/publisher_already_running/);
  assert.deepEqual([await lstat(sidecar),await lstat(mutex)].map(s=>s.ino),before.map(s=>s.ino));
  const receipt=JSON.parse(await readFile(`${path}.${status.supervisionId}.supervision.json`,'utf8'));
  assert.equal(receipt.reason,'worker_deadline');assert.equal(receipt.terminationPending,true);assert.equal(receipt.checkpointUpdate,'deferred');
 }finally{
  t.mock.restoreAll();if(group)try{kill(group,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
  // Wait only for our synthetic owner to release its OS lock before removal.
  for(let i=0;i<40;i++)try{await(await lockRun(dir))();break;}catch(e){if(!String(e).includes('publisher_already_running'))throw e;await new Promise(r=>setTimeout(r,25));}
  await rm(dir,{recursive:true,force:true});
 }
});

test('a reused PID cannot attach a new supervision outcome to an earlier checkpoint',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-supervisor-')),path=join(dir,'status.json');
 try{
  const script=`require('fs').writeFileSync(process.argv[1],JSON.stringify({pid:process.pid,supervisionId:'earlier-run',state:'running',sentinel:'preserve'}));process.exit(7)`;
  assert.equal(await superviseRefresh(['-e',script,path],path),7);
  const status=JSON.parse(await readFile(path,'utf8'));
  assert.equal(status.supervisionId,'earlier-run');assert.equal(status.state,'running');assert.equal(status.sentinel,'preserve');
  const names=(await readdir(dir)).filter(n=>n.endsWith('.supervision.json'));assert.equal(names.length,1);
  const receipt=JSON.parse(await readFile(join(dir,names[0]),'utf8'));
  assert.equal(receipt.pid,status.pid);assert.notEqual(receipt.supervisionId,status.supervisionId);
  assert.ok(names[0].includes(receipt.supervisionId));assert.equal(receipt.checkpointUpdate,'not_owned');
  assert.equal(receipt.reason,'worker_exited');assert.equal(receipt.exitCode,7);
  assert.ok(Number.isFinite(Date.parse(receipt.startedAt)));assert.ok(Number.isFinite(Date.parse(receipt.observedAt)));assert.ok(receipt.elapsedMs>=0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
