import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync,crc32 } from 'node:zlib';
import { preparePublication } from '../scripts/tic-refresh';
function zip(bytes:Buffer,corrupt=false){
 const name=Buffer.from('source.json'),body=deflateRawSync(bytes),sum=crc32(bytes)^(corrupt?1:0);
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(sum>>>0,14);local.writeUInt32LE(body.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(sum>>>0,16);central.writeUInt32LE(body.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+body.length,16);
 return Buffer.concat([local,name,body,central,name,end]);
}
test('managed preparation reads ZIP by signature and requires verified CRC before publication receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'refresh-zip-'));
 try{
  const sourcePath=join(root,'source.json.gz'),tocPath=join(root,'toc.json'),sourceUrl='https://example.com/source.zip';
  const date=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const bytes=Buffer.from(JSON.stringify({reporting_entity_name:'Fixture insurer',last_updated_on:date,version:'2.0.0',in_network:[{negotiated_rates:[{provider_groups:[{npi:[1234567890],tin:{type:'ein',value:'111111111'}}]}]}]}));
  await writeFile(sourcePath,zip(bytes));await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_name:'Fixture',plan_id_type:'EIN',plan_id:'111111111',plan_market_type:'group'}]}]}));
  const args={sourcePath,sourceUrl,tocPath,tocUrl:'https://example.com/index',directory:join(root,'valid')};
  const receipt=await preparePublication(args);assert.equal(receipt.membershipCount,1);assert.equal(receipt.sourceDate,date);
  assert.ok((await readFile(receipt.membershipPath,'utf8')).includes('1234567890'));
  await writeFile(sourcePath,zip(bytes,true));
  await assert.rejects(preparePublication({...args,directory:join(root,'corrupt')}),/CRC/);
  await assert.rejects(stat(join(root,'corrupt','publication.json')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
