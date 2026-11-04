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

test('repeated referenced groups preserve one membership while conflicting identifiers fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-refs-'));
 try{
 const input=join(dir,'source.json'),out=join(dir,'members.jsonl');
 const reference={provider_group_id:7,provider_groups:[{npi:[1234567890],tin:{type:'ein',value:'111111111'}}]};
 const base={reporting_entity_name:'Fixture',last_updated_on:'2026-11-01',version:'2.0.1',provider_references:[reference],in_network:[{negotiated_rates:Array.from({length:10000},()=>({provider_references:[7]}))}]};
 await writeFile(input,JSON.stringify(base));const r=await runExtract({input,out,strictReferences:true,progress:false,maxPairs:1});assert.equal(r.pairs_emitted,1);
 await writeFile(input,JSON.stringify({...base,provider_references:[reference,{...reference,provider_groups:[{npi:[9999999999],tin:{type:'ein',value:'222222222'}}]}]}));
 await assert.rejects(runExtract({input,out:join(dir,'rejected.jsonl'),strictReferences:true,progress:false}),/Duplicate provider reference/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('strict reference memory budgets reject one large group and cumulative small groups before output', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'affinity-reference-budget-'));
 try {
  const input=join(dir,'source.json'),out=join(dir,'members.jsonl');
  const references=Array.from({length:30},(_,id)=>({provider_group_id:id,provider_groups:[{npi:[1234567890],tin:{type:'ein',value:'111111111'}}]}));
  await writeFile(input,JSON.stringify({provider_references:references,in_network:[]}));
  await assert.rejects(runExtract({input,out,strictReferences:true,progress:false,maxGroupBudget:1000}),/reference_memory_limit/);
  await assert.rejects(runExtract({input,out,strictReferences:true,progress:false,maxGroupBudget:100000,maxReferenceBudget:12000}),/reference_memory_limit/);
  await assert.rejects(stat(out));
 }finally{await rm(dir,{recursive:true,force:true});}
});
