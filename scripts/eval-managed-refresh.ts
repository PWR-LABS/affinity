import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { publishManaged } from './lib/managed-publication';
import { sha256, type TicPublication } from '../src/lib/tic/publication';
const url=new URL(process.env.DATABASE_URL??'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/affinity_employer_e2e');
const db=new PrismaClient();
const passed:string[]=[];
async function main(){
 const root=await mkdtemp(join(tmpdir(),'affinity-managed-'));
 try{
 await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "TicRefreshPublication" ("id" text PRIMARY KEY, "stableKey" text NOT NULL, "fileId" text NOT NULL UNIQUE REFERENCES "TicFile"(id) ON DELETE CASCADE, "sourceDate" text NOT NULL, "contentHash" text NOT NULL, "receiptPath" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())');
 await db.ticFile.deleteMany();
 const legacy=await db.ticFile.create({data:{url:'https://example.com/legacy',reportingEntity:'Preserve',fetchedAt:new Date()}});
 const receipts:TicPublication[]=[];
 for(let i=0;i<4;i++){
 const date=new Date(Date.now()-(4-i)*86400000).toISOString().slice(0,10);
 const sourceUrl=`https://example.com/${date}/network.json`;
 const sourcePath=join(root,`source-${i}.json`),tocPath=join(root,`toc-${i}.json`),membershipPath=join(root,`members-${i}.jsonl`);
 const plans=[{planName:'Synthetic',planId:'111111111',planIdType:'ein' as const,planMarketType:'group'}];
 await writeFile(sourcePath,JSON.stringify({date}));
 await writeFile(tocPath,JSON.stringify({reporting_structure:[{in_network_files:[{location:sourceUrl}],reporting_plans:[{plan_name:'Synthetic',plan_id:'111111111',plan_id_type:'ein',plan_market_type:'group'}]}]}));
 const rows=Array.from({length:1001},(_,j)=>JSON.stringify({npi:String(1000000000+j),tin_type:'ein',tin_value:'111111111',file_url:sourceUrl,reporting_entity:'Test',last_updated_on:date,schema:'v1'}));
 await writeFile(membershipPath,rows.join('\n')+'\n');
 const r:TicPublication={version:1,scope:'selected-file-only; plan completeness unverified',sourceUrl,tocUrl:'https://example.com/toc',sourcePath,tocPath,membershipPath,sourceSha256:await sha256(sourcePath),tocSha256:await sha256(tocPath),membershipSha256:await sha256(membershipPath),membershipCount:rows.length,sourceDate:date,reportingEntity:'Test',schema:'v1',plans,preparedAt:new Date().toISOString()};
 receipts.push(r);await writeFile(join(root,`receipt-${i}.json`),JSON.stringify(r));
 }
 const publish=(i:number,guard=()=>{})=>publishManaged(db,receipts[i],join(root,`receipt-${i}.json`),guard,root);
 await publish(0);await publish(1);
 let checks=0;await assert.rejects(publish(2,()=>{if(++checks===4)throw new Error('simulated_disconnect');}),/simulated_disconnect/);
 assert.equal(await db.ticFile.count(),3);assert.equal(await db.ticMembership.count(),2002);
 passed.push('disconnect after first DB batch rolls back new rows and leaves both prior generations');
 checks=0;await assert.rejects(publish(2,()=>{if(++checks===6)throw new Error('disconnect_before_commit');}),/disconnect_before_commit/);
 assert.equal(await db.ticFile.count(),3);assert.equal(await db.ticMembership.count(),2002);
 passed.push('disconnect after retention deletion but before commit restores retired generation atomically');
 const result=await publish(2);
 assert.equal(await db.ticFile.count(),3);assert.equal(await db.ticMembership.count(),2002);
 assert.ok(await db.ticFile.findUnique({where:{id:legacy.id}}));
 assert.equal(await db.ticFile.count({where:{url:receipts[0].sourceUrl}}),0);
 passed.push('third generation retires only archive-verified owned oldest generation; legacy untouched');
 const replay=await publish(2);assert.equal(replay.fileId,result.fileId);assert.equal(await db.ticFile.count(),3);
 passed.push('lost local receipt after successful commit replays from durable DB identity without duplicates');
 await writeFile(receipts[1].membershipPath,'corrupted');
 await assert.rejects(publish(3),/archive unavailable/);assert.equal(await db.ticFile.count(),3);
 passed.push('unavailable or corrupt historical rollback archive blocks retirement and publication');
 await db.ticFile.delete({where:{id:result.fileId}});
 assert.equal(await db.ticMembership.count(),1001);
 passed.push('withdrawal of newest generation preserves preceding serving generation');
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),passed},null,2));
 }finally{await db.ticFile.deleteMany();await db.$disconnect();await rm(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
