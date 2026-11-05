import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,symlink} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sha256} from '../src/lib/tic/publication';
import {reuseSourceArchive,type SourceArchive} from '../scripts/lib/source-archive';
test('source reuse requires current validators and exact archived bytes while preserving originals',async()=>{
 const root=realpathSync(await mkdtemp(join(tmpdir(),'affinity-source-reuse-')));
 try{
  const source=join(root,'original.json'),targetDir=join(root,'new');await mkdir(targetDir);await writeFile(source,'{"complete":"original"}');
  const entry:SourceArchive={sourceUrl:'https://example.com/source.json',path:source,bytes:(await stat(source)).size,sha256:await sha256(source),etag:'version1',lastModified:null};
  const args={sourceUrl:entry.sourceUrl,etag:entry.etag,destination:join(targetDir,'source.json'),root,maxBytes:2000,guard:()=>{}};
  assert.equal(await reuseSourceArchive(entry,{...args,etag:null}),undefined);
  assert.equal(await reuseSourceArchive(entry,{...args,etag:'version2'}),undefined);
  assert.equal(await reuseSourceArchive(entry,{...args,sourceUrl:'https://example.com/different.json'}),undefined);
  assert.equal(await reuseSourceArchive(entry,{...args,maxBytes:1}),undefined);
  const result=await reuseSourceArchive(entry,args);assert.equal(result!.sha256,entry.sha256);
  assert.equal(await readFile(source,'utf8'),await readFile(args.destination,'utf8'));
  assert.notEqual((await stat(source)).ino,(await stat(args.destination)).ino);
  await writeFile(args.destination,'mutated-copy');assert.equal(await sha256(source),entry.sha256);
  assert.match(await readFile(join(targetDir,'MANIFEST.md'),'utf8'),/Original not moved or deleted/);
  await assert.rejects(reuseSourceArchive(entry,args),{code:'EEXIST'});
  await assert.rejects(reuseSourceArchive({...entry,sha256:'a'.repeat(64)},args),/hash mismatch/);
  await assert.rejects(reuseSourceArchive(entry,{...args,destination:join(root,'..','outside.json')}),/Unsafe/);
  const linked=join(root,'linked.json');await symlink(source,linked);
  await assert.rejects(reuseSourceArchive({...entry,path:linked},args),/Unsafe/);
  assert.equal(await reuseSourceArchive({...entry,path:join(root,'missing.json')},args),undefined);
  await assert.rejects(reuseSourceArchive(entry,{...args,guard(){throw new Error('ssd_disconnected');}}),/ssd_disconnected/);
 }finally{await rm(root,{recursive:true,force:true});}
});
