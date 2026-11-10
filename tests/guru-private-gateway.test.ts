import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {privateGateway,reviewEvidence} from '../scripts/guru-integration/private-gateway';
import {initialContext,requestKey} from '../src/lib/guru/workspace';
import {validateBound,type runPrivateTurn} from '../scripts/guru-integration/private-runtime';
import {conversationBody} from '../src/lib/guru/conversation';

test('synthetic evidence is server-derived, bound to current inputs, and never implies membership',()=>{
 const c={...initialContext(2027),npi:'1234567890',planId:'111111111'};
 const e=reviewEvidence(['network','network'],c);
 assert.equal(e.length,1);assert.equal(e[0].requestKey,requestKey('network',c));
 assert.match(e[0].title,/unknown/);assert.match(e[0].notes[0],/SYNTHETIC/);
 assert.equal(e[0].facts.find(f=>f.label==='Evidence status')?.value,'unknown');
});
test('private gateway rejects wrong origin and client evidence before dispatch, fixes phase server-side',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'affinity-gateway-'));let calls=0;
 const turn=(async(options:Parameters<typeof runPrivateTurn>[0])=>{
  calls++;assert.equal(options.request.phase,'interactive');assert.equal(options.request.model,'gpt-6.1-terra');
  assert.match(options.evidence[0].notes[0],/SYNTHETIC/);
  return {reply:{step:'coverage',changes:{},reply:'Synthetic status remains unknown.',proposedAction:'none',evidenceIds:['private-network']}};
 }) as typeof runPrivateTurn;
 const server=privateGateway({root,key:'synthetic',manifestHash:'a'.repeat(64),verifySource:async()=>{},turn});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address() as {port:number};const url=`http://127.0.0.1:${address.port}/api/guru`;
 const body={id:randomUUID(),history:[{role:'you',text:'Can I keep my doctor?',superseded:false}],context:initialContext(2027),evidenceActions:['network']};
 const post=(value:unknown,origin='http://127.0.0.1:3013')=>fetch(url,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)});
 try{
  assert.equal((await post(body,'https://untrusted.example')).status,403);
  assert.equal((await post({...body,evidence:[{value:'yes'}]})).status,503);
  assert.equal((await post({...body,phase:'held_out'})).status,503);
  assert.equal(calls,0);
  const response=await post(body);assert.equal(response.status,200);const output=await response.json();
  assert.equal(output.review.mode,'synthetic');assert.equal(output.review.remainingTurns,10);assert.equal(calls,1);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true});}
});
test('private bound rejects expired prices and oversized serialized conversation before reservation',()=>{
 const c=initialContext(2027),body=conversationBody('gpt-6.1-terra',[{role:'you',text:'Help me',superseded:false}],c,[]);
 assert.ok(validateBound(body,new Date('2026-11-10')).upperMicro<50000);
 assert.throws(()=>validateBound(body,new Date('2026-11-20')));
 assert.throws(()=>validateBound({...body,input:[{role:'user',content:'x'.repeat(20000)}]},new Date('2026-11-10')));
});
