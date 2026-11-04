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
