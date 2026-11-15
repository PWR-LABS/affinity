import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {validReadinessProof} from '../src/lib/guru/readiness';
const {allowed,ensure}=createRequire(import.meta.url)('../scripts/ensure-guru-schema.cjs');
test('readback proof requires the dedicated secret and a valid non-future five-minute signature',()=>{
 const secret='ab'.repeat(32),now=Date.parse('2026-11-15T02:00:00Z');
 const signature=createHmac('sha256',Buffer.from(secret,'hex')).update('guru-readiness:'+now).digest('hex'),proof=`${now}.${signature}`;
 assert.equal(validReadinessProof(proof,secret,now),true);
 assert.equal(validReadinessProof(proof,secret,now+300000),true);
 assert.equal(validReadinessProof(proof,secret,now+300001),false);
 assert.equal(validReadinessProof(proof,secret,now-1),false);
 for(const value of [null,'bad',`${now}.${'f'.repeat(64)}`,proof+'.extra'])assert.equal(validReadinessProof(value,secret,now),false);
 assert.equal(validReadinessProof(proof,'cd'.repeat(32),now),false);
});
test('startup migration refuses wrong service, branch or database and preserves capacity guard',async()=>{
 const env={RENDER:'true',RENDER_SERVICE_ID:'srv-d9227o9kh4rs73c4i1tg',RENDER_GIT_BRANCH:'main',DATABASE_URL:'postgresql://u:p@dpg-d93fiqpkh4rs73d75cjg-a/affinity_db_grhk'};
 assert.equal(allowed(env),true);assert.equal(allowed({}),false);
 for(const changes of [{RENDER_SERVICE_ID:'other'},{RENDER_GIT_BRANCH:'feature'},{DATABASE_URL:'postgresql://u:p@localhost/other'}])assert.throws(()=>allowed({...env,...changes}),/target rejected/);
 let ddl=0;
 const tx={$executeRawUnsafe:async(s:string)=>{if(/CREATE|ALTER/.test(s))ddl++;},$queryRawUnsafe:async()=>[{bytes:2500000000n}]};
 await assert.rejects(ensure({$transaction:async(f:(tx:unknown)=>unknown)=>f(tx)}),/budget exceeded/);assert.equal(ddl,0);
});
test('unauthenticated readiness requests reveal no ledger or deployment details',async()=>{
 const {POST}=await import('../src/app/api/guru/readiness/route');
 const r=await POST(new Request('https://affinity.example/api/guru/readiness',{method:'POST'}));
 assert.equal(r.status,404);assert.equal(await r.text(),'');
});
