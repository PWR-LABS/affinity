import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {preparePublication} from '../scripts/tic-refresh';
import {validatePublication} from '../src/lib/tic/publication';
test('SSD extraction yields a complete publishable receipt equivalent to the existing strict path',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'affinity-disk-publication-')));
 try{
  const sourcePath=join(root,'source.json'),tocPath=join(root,'toc.json'),sourceUrl='https://example.com/large-source.json';
  const date=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const data={reporting_entity_name:'Fixture insurer',last_updated_on:date,version:'2.0.0',in_network:[{negotiated_rates:[{provider_references:[7]}]}],provider_references:[{provider_groups:[{npi:[1234567890,1234567890,0,123456789],tin:{value:'111111111',type:'EIN'}}],provider_group_id:7}]};
  await writeFile(sourcePath,JSON.stringify(data));
  await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_id_type:'EIN',plan_id:'111111111',plan_name:'Fixture plan',plan_market_type:'group'}]}]}));
  const common={sourcePath,sourceUrl,tocPath,tocUrl:'https://example.com/toc'};
  const memory=await preparePublication({...common,directory:join(root,'memory')});
  const disk=await preparePublication({...common,directory:join(root,'disk'),disk:{scratchRoot:join(root,'disk')}});
  await validatePublication(disk);
  assert.equal(disk.membershipCount,1);assert.equal(disk.sourceSha256,memory.sourceSha256);
  assert.deepEqual(JSON.parse((await readFile(disk.membershipPath,'utf8')).trim()),JSON.parse((await readFile(memory.membershipPath,'utf8')).trim()));
  assert.deepEqual(disk.plans,memory.plans);
  await writeFile(sourcePath,JSON.stringify(data).slice(0,-1));
  await assert.rejects(preparePublication({...common,directory:join(root,'broken'),disk:{scratchRoot:join(root,'broken')}}));
  await assert.rejects(stat(join(root,'broken','publication.json')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
