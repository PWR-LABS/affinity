/** Disposable, synthetic, loopback-only gate. Never reads DATABASE_URL. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { reserveTurn } from '../src/lib/guru/budget';
import { planTurn } from '../src/lib/guru/planner';
import { initialContext } from '../src/lib/guru/workspace';

async function main(){
const url=new URL(process.env.AFFINITY_GURU_TEST_DATABASE_URL??'');
assert.equal(url.hostname,'127.0.0.1');
assert.match(url.pathname,/^\/affinity_guru_e2e_\d+$/);
const db=new PrismaClient({datasourceUrl:url.href}),second=new PrismaClient({datasourceUrl:url.href});
try{
 // CREATE must succeed on a fresh fixture. Do not reuse or truncate an existing table.
 const sql=await readFile(new URL('../prisma/migrations/20261110000000_guru_budget/migration.sql',import.meta.url),'utf8');
 for(const statement of sql.split(';').filter(s=>s.trim()))await db.$executeRawUnsafe(statement);
 const ids=Array.from({length:8},()=>randomUUID());
 const results=await Promise.allSettled(ids.map((id,i)=>reserveTurn(i%2?db:second,id,100000,100000)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 const rows=await db.$queryRaw<Array<{id:string;reservedMicro:number}>>`SELECT id,"reservedMicro" FROM "GuruReservation"`;
 assert.equal(rows.length,2);assert.equal(rows.reduce((a,r)=>a+r.reservedMicro,0),100000);
 await assert.rejects(reserveTurn(db,rows[0].id,1000000,1000000),/already reserved/);
 await db.$disconnect();
 const reconnected=new PrismaClient({datasourceUrl:url.href});
 try{
  await assert.rejects(reserveTurn(reconnected,randomUUID(),100000,100000),/exhausted/);
  let calls=0;const id=randomUUID();
  await assert.rejects(planTurn({model:'gpt-6.1-terra',message:'Compare my options',context:initialContext(2027),key:'synthetic',now:new Date('2026-11-10'),reserve:()=>reserveTurn(reconnected,id,200000,200000),fetcher:(async()=>{calls++;throw Error('simulated lost response');}) as typeof fetch}),/lost response/);
  assert.equal(calls,1);
  const spent=await reconnected.$queryRaw<Array<{micro:bigint}>>`SELECT sum("reservedMicro") AS micro FROM "GuruReservation"`;
  assert.equal(Number(spent[0].micro),150000);
  await assert.rejects(reserveTurn(reconnected,id,200000,200000),/already reserved/);
  console.log(JSON.stringify({state:'passed',checks:['two independent clients share the hard cap','concurrent reservations serialize','duplicate request identity is never redispatched','reservations survive disconnect/reconnect','ambiguous provider failure retains its reservation with no retry'],externalModelCalls:0}));
 }finally{await reconnected.$disconnect();}
}finally{await db.$disconnect();await second.$disconnect();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
