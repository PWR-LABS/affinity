import { createRequire } from 'node:module';
import { PRICING_DATE as reviewedPricingDate, TERRA_RESERVATION_MICRO } from '../src/lib/guru/planner';
/** Disposable, synthetic, loopback-only gate. Never reads DATABASE_URL. */
import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { reserveTurn as reserveWithIdentity, recordTurnUsage, GuruLimitError } from '../src/lib/guru/budget';
import { planTurn } from '../src/lib/guru/planner';
import { initialContext } from '../src/lib/guru/workspace';
import { VISITOR_LIMITS, NETWORK_LIMITS, TEST_BROWSER_LIMITS } from '../src/lib/guru/allowance';
import { testBrowserFingerprint, testBrowserIdentity } from '../src/lib/guru/test-browser';

const identity = (visitor:string,network=visitor) => ({visitorHash:createHash('sha256').update(visitor).digest('hex'),networkHash:createHash('sha256').update(network).digest('hex')});
const reserveTurn = (db:PrismaClient,id:string,monthly:number,daily:number) => reserveWithIdentity(db,id,monthly,daily,identity('baseline'));
async function main(){
const url=new URL(process.env.AFFINITY_GURU_TEST_DATABASE_URL??'');
assert.equal(url.hostname,'127.0.0.1');
assert.match(url.pathname,/^\/affinity_guru_e2e_\d+$/);
const db=new PrismaClient({datasourceUrl:url.href}),second=new PrismaClient({datasourceUrl:url.href});
try{
 const {ensure}=createRequire(import.meta.url)('./ensure-guru-schema.cjs');
 // CREATE must succeed on a fresh fixture. Do not reuse or truncate an existing table.
 for(const migration of ['20261110000000_guru_budget','20261112000000_guru_fair_use']){
 const sql=await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`,import.meta.url),'utf8');
 for(const statement of sql.replace(/^--.*$/gm,'').split(';').filter(s=>s.trim()))await db.$executeRawUnsafe(statement);
 }
 await ensure(db); await ensure(db);
 const ids=Array.from({length:8},()=>randomUUID());
 const results=await Promise.allSettled(ids.map((id,i)=>reserveTurn(i%2?db:second,id,100000,100000)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 const rows=await db.$queryRaw<Array<{id:string;reservedMicro:number}>>`SELECT id,"reservedMicro" FROM "GuruReservation"`;
 assert.equal(rows.length,2);await ensure(db);assert.equal((await db.$queryRaw<Array<{id:string}>>`SELECT id FROM "GuruReservation"`).length,2);assert.equal(rows.reduce((a,r)=>a+r.reservedMicro,0),100000);
 await assert.rejects(reserveTurn(db,rows[0].id,1000000,1000000),/already reserved/);
 await assert.rejects(reserveTurn(db,rows[0].id.toUpperCase(),1000000,1000000),/already reserved/);
 await assert.rejects(reserveTurn(db,randomUUID(),1000000,100000),e=>e instanceof GuruLimitError&&e.scope==='site'&&e.window==='day');
 await db.$disconnect();
 const reconnected=new PrismaClient({datasourceUrl:url.href});
 try{
  await assert.rejects(reserveTurn(reconnected,randomUUID(),100000,100000),/exhausted/);
  let calls=0;const id=randomUUID();
  await assert.rejects(planTurn({model:'gpt-6.1-terra',message:'Compare my options',context:initialContext(2027),key:'synthetic',now:new Date(reviewedPricingDate),reserve:()=>reserveTurn(reconnected,id,200000,200000),fetcher:(async()=>{calls++;throw Error('simulated lost response');}) as typeof fetch}),/lost response/);
  assert.equal(calls,1);
  const spent=await reconnected.$queryRaw<Array<{micro:bigint}>>`SELECT sum("reservedMicro") AS micro FROM "GuruReservation"`;
  assert.equal(Number(spent[0].micro),150000);
  await assert.rejects(reserveTurn(reconnected,id,200000,200000),/already reserved/);
  await verifyMixedReservations(reconnected,second);
  await verifyTestAllowance(reconnected);
  await fairUse(reconnected,second);
  await verifyUsageExport(reconnected,url);
  console.log(JSON.stringify({state:'passed',checks:['two independent clients share the hard cap','concurrent reservations serialize','duplicate request identity is never redispatched','reservations survive disconnect/reconnect','ambiguous provider failure retains its reservation with no retry','mixed Terra and historical reservation amounts enforce both dollar caps','registered browser uses separate test quotas with the same site cap','concurrent visitor and network quotas','40th browser and 80th network attempts succeed; the next attempts are denied','monthly quotas and cookie reset backstop','historical accounting and pseudonym cleanup','numeric usage survives replay and exports through month-scoped authentication'],externalModelCalls:0}));
 }finally{await reconnected.$disconnect();}
}finally{await db.$disconnect();await second.$disconnect();}

}
main().catch(error=>{console.error(error);process.exitCode=1;});

async function verifyMixedReservations(db:PrismaClient,second:PrismaClient) {
 const who=identity('terra-mixed');
 const reserve=(client:PrismaClient,monthly:number,daily:number)=>
  reserveWithIdentity(client,randomUUID(),monthly,daily,who,TERRA_RESERVATION_MICRO);
 const results=await Promise.allSettled([db,second,db].map(client=>reserve(client,240000,210000)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);
 const denied=results.find(r=>r.status==='rejected');
 assert.ok(denied?.reason instanceof GuruLimitError);
 assert.equal(denied.reason.window,'day');
 await assert.rejects(reserve(db,210000,200000),e=>e instanceof GuruLimitError&&e.window==='month');
 const amounts=await db.$queryRaw<Array<{reservedMicro:number}>>`SELECT "reservedMicro" FROM "GuruReservation"`;
 assert.deepEqual(amounts.map(row=>row.reservedMicro).sort((a,b)=>a-b),[30000,30000,50000,50000,50000]);
}

async function verifyTestAllowance(db:PrismaClient) {
 const visitor=identity('registered-test','shared-test-network');
 const grant=testBrowserFingerprint(visitor)+'.'+(Math.floor(Date.now()/1000)+3600);
 const tester=testBrowserIdentity(visitor,grant);
 assert.ok(tester);
 const reserve=(who:ReturnType<typeof identity>,testBrowser=false,daily=5e6)=>
  reserveWithIdentity(db,randomUUID(),100e6,daily,who,TERRA_RESERVATION_MICRO,testBrowser);
 for(let i=0;i<TEST_BROWSER_LIMITS.minute;i++)await reserve(tester,true);
 await assert.rejects(reserve(tester,true),e=>e instanceof GuruLimitError&&e.scope==='visitor'&&e.window==='minute');
 await reserve(visitor);
 const [total]=await db.$queryRaw<Array<{micro:bigint}>>`SELECT sum("reservedMicro") AS micro FROM "GuruReservation"`;
 await assert.rejects(reserve(tester,true,Number(total.micro)),e=>e instanceof GuruLimitError&&e.scope==='site'&&e.window==='day');
}

async function verifyUsageExport(db:PrismaClient,url:URL) {
 const id=randomUUID();
 await reserveWithIdentity(db,id,100e6,100e6,identity('usage-fixture'));
 const usage={
  model:'gpt-6.1-terra' as const,inputTokens:1200,cachedInputTokens:1000,
  cacheWriteInputTokens:0,outputTokens:100,reasoningTokens:50,estimatedCostPicoUsd:BigInt(750_000_000),
 };
 await recordTurnUsage(db,id.toUpperCase(),usage);
 await assert.rejects(recordTurnUsage(db,id,{...usage,estimatedCostPicoUsd:BigInt(1)}),/could not be recorded/);

 // The actual readback route uses only this script's already validated loopback fixture.
 process.env.DATABASE_URL=url.href;
 const secret='aa'.repeat(32);
 process.env.AFFINITY_GURU_VISITOR_SECRET=secret;
 const {GET}=await import('../src/app/api/guru/usage/route');
 const {prisma:exportDb}=await import('../src/lib/prisma');
 try {
  const now=Date.now(),month=new Date(now).toISOString().slice(0,7);
  const proof=(domain:string)=>now+'.'+createHmac('sha256',Buffer.from(secret,'hex')).update(domain+':'+now).digest('hex');
  const exportUrl='https://affinity.example/api/guru/usage?month='+month;
  const rejected=await GET(new Request(exportUrl,{headers:{'x-affinity-usage-proof':proof('guru-readiness')}}));
  assert.equal(rejected.status,404);
  const response=await GET(new Request(exportUrl,{headers:{'x-affinity-usage-proof':proof('guru-usage:'+month)}}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  const csv=await response.text();
  assert.match(csv,/^attempted_at_utc,model,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,reasoning_tokens,estimated_cost_usd/);
  assert.match(csv,/,gpt-6.1-terra,1200,1000,0,100,50,0\.000750000000\r\n/);
  assert.match(csv,/Z,{7}\r\n/); // A prior reservation has unknown cost and usage.
  assert.ok(!csv.includes(id));
  assert.ok(!csv.includes(identity('usage-fixture').visitorHash));
  assert.ok(!csv.includes('reservedMicro'));
 } finally {
  await exportDb.$disconnect();
 }
}

async function fairUse(db:PrismaClient,second:PrismaClient){
 const reserve=(who:ReturnType<typeof identity>,client=db)=>reserveWithIdentity(client,randomUUID(),100e6,100e6,who);
 const limit=(scope:string,window:string)=>(e:unknown)=>e instanceof GuruLimitError&&e.scope===scope&&e.window===window&&e.retryAfter>0;
 const visitor=identity('burst');
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>reserve(visitor,i%2?db:second)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,3);
 await assert.rejects(reserve(visitor),limit('visitor','minute'));
 let calls=0;
 await assert.rejects(planTurn({model:'gpt-6.1-terra',message:'Compare my options',context:initialContext(2027),key:'synthetic',now:new Date(reviewedPricingDate),reserve:()=>reserve(visitor),fetcher:(async()=>{calls++;throw Error('must not dispatch');}) as typeof fetch}),limit('visitor','minute'));
 assert.equal(calls,0);
 await reserve(identity('other'));
 // Fixture-owned rows only; advance synthetic usage outside the burst window.
 await db.$executeRaw`UPDATE "GuruReservation" SET "createdAt"=now()-interval '2 minutes' WHERE "visitorHash"=${visitor.visitorHash}`;
 const seed=async(who:ReturnType<typeof identity>,count:number,date:Date)=>{
  for(let i=0;i<count;i++)await db.$executeRaw`INSERT INTO "GuruReservation" (id,"reservedMicro","createdAt","visitorHash","networkHash") VALUES (${randomUUID()},50000,${date},${who.visitorHash},${who.networkHash})`;
 };
 const [{now}]=await db.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
 const earlierToday=new Date(Math.max(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()),now.getTime()-120000));
 const dayUser=identity('day-user');await seed(dayUser,VISITOR_LIMITS.day-1,earlierToday);
 await reserve(dayUser);
 await assert.rejects(reserve(dayUser),limit('visitor','day'));
 const oldDay=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1));
 const monthUser=identity('month-user');await seed(monthUser,50,oldDay);
 await assert.rejects(reserve(monthUser),limit('visitor','month'));
 // Fresh signed browser IDs still share one network budget.
 const networkBurst=await Promise.allSettled(Array.from({length:18},(_,i)=>reserve(identity('new-cookie-'+i,'shared-burst'),i%2?db:second)));
 assert.equal(networkBurst.filter(r=>r.status==='fulfilled').length,10);
 await assert.rejects(reserve(identity('reset-cookie','shared-burst')),limit('network','minute'));
 const networkDay=identity('network-day-seed','network-day');await seed(networkDay,NETWORK_LIMITS.day-1,earlierToday);
 await reserve(identity('last-cookie','network-day'));
 await assert.rejects(reserve(identity('new-cookie','network-day')),limit('network','day'));
 // Avoid the site daily cap while seeding a network's historical monthly use.
 const networkMonth=identity('network-month-seed','network-month');await seed(networkMonth,150,oldDay);
 await assert.rejects(reserve(identity('new-cookie','network-month')),limit('network','month'));
 const historic=identity('historic');await seed(historic,1,new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)));
 await reserve(identity('cleanup-trigger'));
 const [retained]=await db.$queryRaw<Array<{count:bigint}>>`SELECT count(*) FROM "GuruReservation" WHERE "createdAt"<${oldDay} AND "visitorHash" IS NULL AND "networkHash" IS NULL AND "reservedMicro"=50000`;
 assert.ok(Number(retained.count)>0);
}
