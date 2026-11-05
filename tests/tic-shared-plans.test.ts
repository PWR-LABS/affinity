import test from 'node:test';import assert from 'node:assert/strict';
import {planSet} from '../src/lib/tic/shared-plans';
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
