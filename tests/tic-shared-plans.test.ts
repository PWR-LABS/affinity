import test from 'node:test';import assert from 'node:assert/strict';
import {planSet,planReservationCount,escapeIlikePattern,searchTicPlans} from '../src/lib/tic/shared-plans';
import {employerIndexReady} from '../src/lib/coverage-readiness';
const plan={planName:'Employer "A"\n🧬',planIdType:'ein',planId:'123456789',planMarketType:'group'};
test('shared plan identity is order-independent and preserves every exact field',()=>{
 const other={...plan,planName:'Other'};
 assert.deepEqual(planSet([plan,other]),planSet([other,plan]));
 for(const field of ['planName','planId','planMarketType'] as const)assert.notEqual(planSet([plan]).id,planSet([{...plan,[field]:plan[field]+'x'}]).id);
 assert.notEqual(planSet([plan]).id,planSet([{...plan,planIdType:'hios'}]).id);
 assert.notEqual(planSet([{...plan,planName:'ab',planMarketType:'c'}]).id,planSet([{...plan,planName:'a',planMarketType:'bc'}]).id);
 assert.notEqual(planSet([{...plan,planName:'é'}]).id,planSet([{...plan,planName:'e\u0301'}]).id);
 assert.throws(()=>planSet([]));assert.throws(()=>planSet([plan,plan]),/Duplicate/);assert.throws(()=>planSet([{...plan,planIdType:'unknown'}]));
 for(const planName of ['\ud800','\0'])assert.throws(()=>planSet([{...plan,planName}]),/lossless/);
});

test('new shared mappings reserve actual metadata bytes while a verified existing set reserves an association',async()=>{
 const plans=[{...plan,planName:'x'.repeat(20000)}];
 const absent={ticPlanSet:{findUnique:async()=>null}} as unknown as Parameters<typeof planReservationCount>[0];
 const units=await planReservationCount(absent,plans,true);assert.ok(units*2000>=planSet(plans).metadataBytes*3);assert.ok(units>plans.length);
 assert.equal(await planReservationCount(absent,plans,false),1);
});

test('searchTicPlans bounds deduplication, limit, ILIKE wildcards and statement timeout in SQL',async()=>{
 assert.equal(escapeIlikePattern('100%_a\\b'),'100\\%\\_a\\\\b');
 let executedSql='',queriedSql='',queriedValues:unknown[]=[];
 const expected=[{planIdType:'ein',planId:'123456789',planName:'Anthem PPO',marketType:'group',issuer:'Anthem'}];
 const mockDb={
  $transaction:async<T>(fn:(tx:unknown)=>Promise<T>)=>fn({
   $executeRawUnsafe:async(sql:string)=>{executedSql=sql;return 0;},
   $queryRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{queriedSql=strings.join('?');queriedValues=values;return expected;},
  }),
  $queryRaw:async()=>{throw new Error('should run inside transaction when available');},
 } as unknown as Parameters<typeof searchTicPlans>[0];
 const now=new Date('2026-11-19T17:00:00.000Z');
 assert.deepEqual(await searchTicPlans(mockDb,'a',now),[]);
 assert.equal(executedSql,'');
 const rows=await searchTicPlans(mockDb,'  Anthem_100%  ',now);
 assert.deepEqual(rows,expected);
 assert.match(executedSql,/SET LOCAL statement_timeout = '8000'/);
 assert.match(queriedSql,/WITH eligible_files AS MATERIALIZED/);
 assert.match(queriedSql,/JOIN LATERAL/);
 assert.match(queriedSql,/GROUP BY "planIdType", "planId", "planName"/);
 assert.match(queriedSql,/LIMIT 12/);
 assert.match(queriedSql,/ESCAPE '\\'/);
 assert.equal(queriedValues.length,6);
 assert.deepEqual(queriedValues[0],new Date('2026-09-20T17:00:00.000Z'));
 assert.deepEqual(queriedValues[1],now);
 assert.deepEqual(queriedValues[2],new Date('2026-09-20T17:00:00.000Z'));
 assert.deepEqual(queriedValues[3],now);
 assert.equal(queriedValues[4],'%Anthem\\_100\\%%');
 assert.equal(queriedValues[5],'%Anthem\\_100\\%%');
});

test('employerIndexReady checks both legacy and shared plans with EXISTS and LIMIT 1',async()=>{
 let sql='';
 const db={
  $queryRaw:async(strings:TemplateStringsArray)=>{sql=strings.join('?');return [{ok:1}];},
 } as unknown as Parameters<typeof employerIndexReady>[0];
 assert.equal(await employerIndexReady(db,new Date('2026-11-19T17:00:00.000Z')),true);
 assert.match(sql,/TicFilePlanSet/);
 assert.match(sql,/TicPlanLink/);
 assert.match(sql,/LIMIT 1/);
});
