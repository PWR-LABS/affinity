import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrismaClient} from '@prisma/client';
import {createSourceProofKey} from '../src/lib/tic/source-proof';
import {validatePublication} from '../src/lib/tic/publication';
import {preparePublication} from './tic-refresh';
import {compactSourceArchive} from './lib/source-compaction';
import {publishManaged,withdrawManaged} from './lib/managed-publication';
import {queryTicAnswer} from '../src/lib/tic/adapter';
const url=new URL(process.env.DATABASE_URL??'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/affinity_employer_e2e');
const db=new PrismaClient();
async function main(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'affinity-compacted-pg-'))),keyPath=join(root,'key');
 const passed:string[]=[];
 try{
  await createSourceProofKey(keyPath);await db.ticFile.deleteMany();
  let priorId='';
  const prepared=[];
  for(let i=0;i<3;i++){
   const dir=join(root,String(i));await mkdir(dir);const sourcePath=join(dir,'source.json.gz'),tocPath=join(dir,'toc.json'),sourceUrl='https://example.com/compacted-network.json';
   const date=new Date(Date.now()-(4-i)*86400000).toISOString().slice(0,10);
   await writeFile(sourcePath,JSON.stringify({reporting_entity_name:'Synthetic',last_updated_on:date,version:'1.0.0',in_network:[{negotiated_rates:[{provider_groups:[{npi:[1234567890+i],tin:{type:'ein',value:'111111111'}}]}]}]}));
   await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_id_type:'ein',plan_id:'111111111',plan_name:'Synthetic',plan_market_type:'group'}]}]}));
   const receipt=await preparePublication({sourcePath,sourceUrl,tocPath,tocUrl:'https://example.com/toc',directory:dir,disk:{scratchRoot:dir}});
   await writeFile(join(dir,'download.json'),JSON.stringify({bytes:(await stat(sourcePath)).size,sha256:receipt.sourceSha256}));
   const receiptPath=join(dir,'publication.json');
   // First input represents complete preparation held locally before capacity is available.
   const retained=await db.$queryRaw<Array<{receiptPath:string}>>`SELECT "receiptPath" FROM "TicRefreshPublication"`;
   await compactSourceArchive({receiptPath,ownedRunRoot:root,guard:()=>{},retainedReceiptPaths:retained.map(r=>r.receiptPath),keyPath});
   const compacted=await validatePublication(JSON.parse(await readFile(receiptPath,'utf8')),keyPath);prepared.push(compacted);
   assert.equal(await db.ticFile.count(),Math.min(i,2));
   if(i===0)passed.push('compacted preparation is not a DB publication; capacity-deferred data remains locally verifiable');
   const result=await publishManaged(db,compacted,receiptPath,()=>{},root,keyPath);
   const replay=await publishManaged(db,compacted,receiptPath,()=>{},root,keyPath);assert.equal(replay.fileId,result.fileId);
   assert.equal((await queryTicAnswer({npi:String(1234567890+i),planIdType:'ein',planId:'111111111',db})).value,'yes');
   if(i===1)priorId=result.fileId;
   if(i===2){
    assert.equal(await db.ticFile.count(),2);await assert.rejects(stat(prepared[0].membershipPath),{code:'ENOENT'});assert.ok(await stat(prepared[0].tocPath));assert.ok(await stat(prepared[0].sourceArchive!.proofPath));
    passed.push('third generation retires compacted oldest normalized rows while preserving TOC and proof');
    const withdrawn=await withdrawManaged(db,result.fileId,()=>{});assert.equal(withdrawn.active,priorId);
    assert.equal((await queryTicAnswer({npi:'1234567891',planIdType:'ein',planId:'111111111',db})).value,'yes');
    assert.equal((await queryTicAnswer({npi:'1234567892',planIdType:'ein',planId:'111111111',db})).value,'unknown');
    passed.push('withdrawal restores preceding compacted serving generation without old positive leakage');
   }
  }
  passed.push('compacted source publication and lost-ack replay preserve exact DB identity');
  console.log(JSON.stringify({checkedAt:new Date().toISOString(),passed},null,2));
 }finally{await db.ticFile.deleteMany();await db.$disconnect();await rm(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
