import { PRICING_DATE as reviewedPricingDate } from '../src/lib/guru/planner';
import test from 'node:test';
import assert from 'node:assert/strict';
import { visitorIdentity, networkAddress, VISITOR_COOKIE } from '../src/lib/guru/visitor';
import { publicCaps, capMicro, reserveTurn } from '../src/lib/guru/budget';
import { VISITOR_LIMITS } from '../src/lib/guru/allowance';

const secret='ab'.repeat(32),now=Date.parse(reviewedPricingDate+'T12:00:00Z');
const request=(ip='203.0.113.12',cookie='')=>new Request('https://affinity.example/api/guru',{headers:{'cf-connecting-ip':ip,cookie}});
test('approved caps default to 100/month and 5/day and only allow lower overrides',()=>{
 assert.deepEqual(publicCaps({}),{monthly:100e6,daily:5e6});
 assert.deepEqual(publicCaps({AFFINITY_GURU_MONTHLY_USD:'10',AFFINITY_GURU_DAILY_USD:'1'}),{monthly:10e6,daily:1e6});
 for(const env of [{AFFINITY_GURU_MONTHLY_USD:'101'},{AFFINITY_GURU_DAILY_USD:'6'},{AFFINITY_GURU_MONTHLY_USD:'1',AFFINITY_GURU_DAILY_USD:'5'},{AFFINITY_GURU_MONTHLY_USD:''}])assert.throws(()=>publicCaps(env));
 assert.equal(capMicro('100'),100e6);
});
test('signed identity survives reload; reset/tamper/expiry does not evade shared network',()=>{
 const first=visitorIdentity(request(),secret,'cf-connecting-ip',now);
 assert.match(first.cookie,/HttpOnly; Secure; SameSite=Strict/);
 assert.ok(!first.identity.networkHash.includes('203.0.113'));
 const cookie=first.cookie.split(';')[0];
 assert.deepEqual(visitorIdentity(request(undefined,cookie),secret,'cf-connecting-ip',now+1000).identity,first.identity);
 const tampered=visitorIdentity(request(undefined,cookie.slice(0,-1)+'x'),secret,'cf-connecting-ip',now);
 assert.notEqual(tampered.identity.visitorHash,first.identity.visitorHash);
 assert.equal(tampered.identity.networkHash,first.identity.networkHash);
 const expired=visitorIdentity(request(undefined,cookie),secret,'cf-connecting-ip',now+32*86400000);
 assert.notEqual(expired.identity.visitorHash,first.identity.visitorHash);
 assert.equal(expired.identity.networkHash,first.identity.networkHash);
 const moved=visitorIdentity(request('203.0.113.13',cookie),secret,'cf-connecting-ip',now);
 assert.equal(moved.identity.visitorHash,first.identity.visitorHash);
 assert.notEqual(moved.identity.networkHash,first.identity.networkHash);
 assert.notEqual(visitorIdentity(request(undefined,`${cookie}; ${cookie}`),secret,'cf-connecting-ip',now).identity.visitorHash,first.identity.visitorHash);
 assert.ok(cookie.startsWith(VISITOR_COOKIE+'='));
});
test('proxy trust is explicit and malformed or missing identity fails closed',()=>{
 for(const key of [undefined,'short'])assert.throws(()=>visitorIdentity(request(),key,'cf-connecting-ip',now));
 for(const header of [undefined,'x-forwarded-for','x-real-ip'])assert.throws(()=>visitorIdentity(request(),secret,header,now));
 for(const ip of ['', 'garbage','203.0.113.12, 203.0.113.13','fe80::1%eth0'])assert.throws(()=>visitorIdentity(request(ip),secret,'cf-connecting-ip',now));
});
test('equivalent IPv6 spellings, /64 rotation and mapped IPv4 cannot split network quota',()=>{
 assert.equal(networkAddress('2001:db8:1:2::abcd'),networkAddress('2001:0db8:0001:0002:1234:0000:0000:0001'));
 assert.notEqual(networkAddress('2001:db8:1:2::1'),networkAddress('2001:db8:1:3::1'));
 assert.equal(networkAddress('::ffff:203.0.113.12'),networkAddress('203.0.113.12'));
});
test('identity is mandatory before database or model work',async()=>{
 await assert.rejects(reserveTurn({} as never,'00000000-0000-0000-0000-000000000000',100e6,5e6,undefined as never),/identity required/);
});

test('public route returns 429 and a signed cookie without provider dispatch; unsafe config is unavailable',async()=>{
 const {mock}=await import('node:test');
 mock.timers.setTime(now);
 const {prisma}=await import('../src/lib/prisma');
 const {POST}=await import('../src/app/api/guru/route');
 const {initialContext}=await import('../src/lib/guru/workspace');
 const keys=['AFFINITY_GURU_ENABLED','AFFINITY_OPENAI_API_KEY','AFFINITY_GURU_MODEL','AFFINITY_GURU_VISITOR_SECRET','AFFINITY_GURU_CLIENT_IP_HEADER','AFFINITY_GURU_MONTHLY_USD','AFFINITY_GURU_DAILY_USD'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const transaction=prisma.$transaction,fetcher=globalThis.fetch;let calls=0,queries=0;
 try{
  Object.assign(process.env,{AFFINITY_GURU_ENABLED:'1',AFFINITY_OPENAI_API_KEY:'synthetic',AFFINITY_GURU_MODEL:'gpt-6.1-terra',AFFINITY_GURU_VISITOR_SECRET:secret,AFFINITY_GURU_CLIENT_IP_HEADER:'cf-connecting-ip',AFFINITY_GURU_MONTHLY_USD:'100',AFFINITY_GURU_DAILY_USD:'5'});
  globalThis.fetch=async()=>{calls++;throw Error('No provider dispatch expected');};
  prisma.$transaction=(async(fn:(tx:unknown)=>Promise<unknown>)=>fn({
   $executeRaw:async()=>0,
   $queryRaw:async(strings:TemplateStringsArray)=>{
    queries++;const sql=strings.join('?');
    if(sql.includes('SELECT id'))return [];
    if(sql.includes('clock_timestamp'))return [{now:new Date(now)}];
    if(sql.includes('sum('))return [{month:BigInt(0),day:BigInt(0)}];
    const day=BigInt(VISITOR_LIMITS.day);
    return [{scope:'visitor',month:day,day,minute:BigInt(0)},{scope:'network',month:day,day,minute:BigInt(0)}];
   },
  })) as typeof transaction;
  const req=()=>new Request('https://affinity.example/api/guru',{method:'POST',headers:{origin:'https://affinity.example','content-type':'application/json','cf-connecting-ip':'203.0.113.12'},body:JSON.stringify({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',history:[{role:'you',text:'Help me compare',superseded:false}],context:initialContext(2027),evidenceActions:[]})});
  const response=await POST(req());
  assert.equal(response.status,429);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.ok(Number(response.headers.get('Retry-After'))>0);assert.match(response.headers.get('Set-Cookie')??'',/__Host-affinity-guru=.*HttpOnly; Secure; SameSite=Strict/);
  const body=await response.json();assert.equal(body.code,'guru_limit');assert.equal(body.scope,'visitor');assert.equal(body.window,'day');assert.match(body.error,/Guided search/);
  assert.equal(calls,0);assert.ok(queries>0);
  const queriesBefore=queries;delete process.env.AFFINITY_GURU_CLIENT_IP_HEADER;
  assert.equal((await POST(req())).status,503);assert.equal(queries,queriesBefore);assert.equal(calls,0);
  process.env.AFFINITY_GURU_CLIENT_IP_HEADER='cf-connecting-ip';
  prisma.$transaction=(async()=>{throw Error('synthetic ledger unavailable');}) as typeof transaction;
  assert.equal((await POST(req())).status,503);assert.equal(calls,0);
 }finally{
  prisma.$transaction=transaction;globalThis.fetch=fetcher;
  for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}
 }
});
