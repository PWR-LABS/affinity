import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preparePublication} from '../scripts/tic-refresh';
import {preparedSource} from '../scripts/lib/prepared-source';
test('capacity-deferred complete receipts can resume without ingestion, but changed source or mappings cannot',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'affinity-prepared-')));
 try{
  const sourcePath=join(root,'source.json'),tocPath=join(root,'toc.json'),sourceUrl='https://example.com/network.json';
  const source={reporting_entity_name:'Fixture',last_updated_on:new Date(Date.now()-86400000).toISOString().slice(0,10),version:'1.0.0',in_network:[{negotiated_rates:[{provider_groups:[{npi:[1234567890],tin:{type:'ein',value:'111111111'}}]}]}]};
  const toc=(planId:string)=>JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_id_type:'ein',plan_id:planId,plan_name:'Fixture',plan_market_type:'group'}]}]});
  await writeFile(sourcePath,JSON.stringify(source));await writeFile(tocPath,toc('111111111'));
  const dir=join(root,'prepared');const receipt=await preparePublication({sourcePath,sourceUrl,tocPath,tocUrl:'https://example.com/toc',directory:dir});
  const entry={etag:'etag-1',policy:'v1',receiptPath:join(dir,'publication.json')};
  const args={etag:'etag-1',policy:'v1',sourceUrl,tocPath,root};
  assert.deepEqual(await preparedSource(entry,args),receipt);
  assert.equal(await preparedSource(entry,{...args,etag:null}),undefined);
  assert.equal(await preparedSource(entry,{...args,etag:'etag-2'}),undefined);
  assert.equal(await preparedSource(entry,{...args,policy:'v2'}),undefined);
  assert.equal(await preparedSource(entry,{...args,sourceUrl:'https://example.com/different.json'}),undefined);
  const changedToc=join(root,'new-toc.json');await writeFile(changedToc,toc('222222222'));
  assert.equal(await preparedSource(entry,{...args,tocPath:changedToc}),undefined);
  await writeFile(sourcePath,JSON.stringify({...source,version:'1.0.1'}));
  await assert.rejects(preparedSource(entry,args),/hash mismatch/);
  await assert.rejects(preparedSource(entry,{...args,root:join(root,'different-root')}),/outside archive/);
 }finally{await rm(root,{recursive:true,force:true});}
});
