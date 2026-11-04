import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExtract } from '../tools/tic-ingest/tic-extract';
test('strict extraction fails before remote fetch and rejects unresolved IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-closure-'));
 try{
  const input=join(dir,'source.json'),out=join(dir,'members.jsonl');
  const base={reporting_entity_name:'Fixture',last_updated_on:'2026-11-01',version:'2.0.1',in_network:[{negotiated_rates:[{provider_references:[7]}]}]};
  await writeFile(input,JSON.stringify({...base,provider_references:[{provider_group_id:7,location:'https://invalid.invalid/never-fetch'}]}));
  await assert.rejects(runExtract({input,out,strictReferences:true,progress:false}),/Unarchived/);
  await assert.rejects(stat(out));
  await writeFile(input,JSON.stringify({...base,provider_references:[{provider_group_id:8,provider_groups:[{npi:[1234567890],tin:{type:'ein',value:'111111111'}}]}]}));
  await assert.rejects(runExtract({input,out,strictReferences:true,progress:false}),/Unresolved/);
  await assert.rejects(stat(out));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('token validation failure destroys upstream input instead of leaking an open stream', async()=>{
 const { Readable }=await import('node:stream');
 const { parseJsonTokens }=await import('../tools/tic-ingest/lib/streaming');
 const input=Readable.from(['{"items":[1,2,3]}']);
 await assert.rejects(parseJsonTokens(input,()=>{throw new Error('stop');}),/stop/);
 assert.equal(input.destroyed,true);
});
