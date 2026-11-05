import test from 'node:test';import assert from 'node:assert/strict';
import {planSet,planReservationCount} from '../src/lib/tic/shared-plans';
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
