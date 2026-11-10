import test from 'node:test';
import assert from 'node:assert/strict';
import {initialContext,comparePremiums,reconcileContext,offerHandoff,missingQuestion,requestKey} from '../src/lib/guru/workspace';
import {applyProposal} from '../src/lib/guru/proposal';
import {bindEvidence,evidenceFingerprint,modelHistory,superseded,type ChatMessage,type ReferencedEvidence} from '../src/lib/guru/chat';
import {conversationBody,conversationTurn} from '../src/lib/guru/conversation';
const context=()=>({...initialContext(2027),state:'OH',zip:'44113',employerPremium:'100',employerFrequency:'biweekly' as const,marketplacePremium:'200',premiumBasis:'self' as const});
const current=():ReferencedEvidence=>({...comparePremiums(context()),id:'current-premium'});
const wire=(value:unknown)=>({model:'gpt-6.1-terra',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('chat and model history supersede changed inputs and same-input changed evidence, not retrieval time',()=>{
 const c=context(),e=current(),message:ChatMessage={role:'guru',text:'The employer premium is $2,600/year.',bindings:[bindEvidence(e)],kind:'model'};
 assert.equal(superseded(message,c,[e]),false);
 const again={...e,observedAt:'2099-01-01T00:00:00Z'};
 assert.equal(evidenceFingerprint(e),evidenceFingerprint(again));assert.equal(superseded(message,c,[again]),false);
 const changed={...e,title:'Current evidence unavailable'};
 assert.equal(superseded(message,c,[changed]),true);
 assert.equal(superseded(message,{...c,employerPremium:'150'},[e]),true);
 assert.equal(superseded(message,c,[]),true);
 const history=modelHistory([message],c,[e]);assert.equal(history[0].superseded,false);
 const sent=JSON.parse(conversationBody('gpt-6.1-terra',history,c,[changed]).input[0].content);
 assert.equal(sent.history[0].superseded,true);
});
test('every shared context write and confirmed proposal resets people basis and changed name identities',()=>{
 const c={...context(),npi:'1234567890',planId:'111111111'};
 for(const next of [reconcileContext(c,{...c,householdSize:'2',premiumBasis:'household'}),applyProposal(c,{step:'compare',changes:{householdSize:'2',premiumBasis:'household'}})]){
  assert.equal(next.premiumBasis,'unknown');assert.throws(()=>comparePremiums(next),/same people/);
 }
 assert.equal(applyProposal(c,{step:'coverage',changes:{doctorQuery:'Dr Sample'}}).npi,'');
 assert.equal(applyProposal(c,{step:'coverage',changes:{employerQuery:'Sample Employer'}}).planId,'');
 assert.equal(reconcileContext(c,{...c,planQuery:'Sample Plan'}).planId,'');
 assert.equal(reconcileContext(c,{...c,npi:'1234567891'}).npi,'1234567891');
});
test('unknown and confirmed household offers retain Medicaid and official affordability handoffs',()=>{
 for(const employerOffer of ['unknown','offered','offered_household'] as const){
  const c={...context(),employerOffer},e=offerHandoff(c)!;
  assert.equal(e.requestKey,requestKey('screen',c));assert.equal(e.facts[1].value,'Not calculated');
  assert.ok(e.notes.some(n=>n.includes('Medicaid')));assert.ok(e.notes.some(n=>/affordability|offer exists/.test(n)));
 }
 assert.match(missingQuestion('screen',{...context(),employerOffer:'unknown'})!,/offered insurance/);
 assert.match(missingQuestion('network',context())!,/doctor’s name/);
 assert.equal(offerHandoff({...context(),employerOffer:'none'}),undefined);
});
test('conversation receives prior turns, confirmed context and evidence; replies cannot invent references',async()=>{
 const c=context(),e=current();let calls=0,reservations=0;
 const history=modelHistory([{role:'you',text:'Why is that cheaper?'},{role:'guru',text:'Premiums are only one cost.',bindings:[bindEvidence(e)]},{role:'you',text:'Can I keep my doctor too?'}],c,[e]);
 const options={model:'gpt-6.1-terra',history,context:c,evidence:[e],key:'synthetic',now:new Date('2026-11-10'),reserve:async()=>{reservations++;},fetcher:(async(_url,init)=>{
  calls++;assert.equal(reservations,calls);const body=JSON.parse(String(init?.body));
  const input=JSON.parse(body.input[0].content);assert.equal(input.history.length,3);assert.equal(input.confirmedContext.zip,'44113');assert.equal(input.CURRENT_EVIDENCE[0].id,'current-premium');assert.equal(body.store,false);assert.equal(body.max_output_tokens,1000);assert.ok(!body.tools);
  return Response.json(wire({step:'coverage',changes:{doctorQuery:null},reply:'The premium difference does not establish doctor coverage. What is your doctor’s name?',proposedAction:'none',evidenceIds:['current-premium']}));
 }) as typeof fetch};
 const reply=await conversationTurn(options);assert.match(reply.reply,/doctor’s name/);assert.deepEqual(reply.changes,{});assert.equal(calls,1);
 await assert.rejects(conversationTurn({...options,fetcher:(async()=>Response.json(wire({...reply,evidenceIds:['invented-source']}))) as typeof fetch}),/Invented evidence/);
});
test('conversation rejects oversize current evidence before reservation, and never retries a lost return',async()=>{
 let reservations=0,calls=0;const options={model:'gpt-6.1-terra',history:[{role:'you' as const,text:'Help me',superseded:false}],context:context(),evidence:[current()],key:'synthetic',now:new Date('2026-11-10'),reserve:async()=>{reservations++;},fetcher:(async()=>{calls++;throw Error('lost response');}) as typeof fetch};
 await assert.rejects(conversationTurn({...options,evidence:[{...current(),notes:['x'.repeat(15000)]}]}),/upper reservation/);assert.equal(reservations,0);assert.equal(calls,0);
 await assert.rejects(conversationTurn(options),/lost response/);assert.equal(reservations,1);assert.equal(calls,1);
});

test('all frozen conversational inputs fit the shared per-request upper bound without leaking expectations',async()=>{
 const {conversationCases,checkConversation}=await import('../scripts/guru-integration/conversation-cases');
 assert.equal(conversationCases.length,8);
 for(const item of conversationCases){
  const body=conversationBody('gpt-6.1-terra',item.history,item.context,item.evidence);
  assert.ok((Buffer.byteLength(JSON.stringify(body))+4096)*2.5+body.max_output_tokens*10<=50000,item.id);
  assert.ok(!JSON.stringify(body).includes('expectedChanges'));
  assert.equal(checkConversation(item,{step:item.steps[0],changes:item.expectedChanges,reply:'synthetic',proposedAction:'none',evidenceIds:item.requiredEvidence}).passed,true);
 }
});

test('the full accepted current user message survives history limits, including a late correction',()=>{
 const text='Background detail. '.repeat(60)+'Correction: household size is 2 and the offer is through my spouse.';
 assert.ok(text.length>750&&text.length<=1500);
 const messages:ChatMessage[]=[...Array.from({length:12},()=>({role:'guru' as const,text:'Older exchange'})),{role:'you',text}];
 const history=modelHistory(messages,context(),[]);
 assert.equal(history.at(-1)?.text,text);assert.match(history[0].text,/Earlier conversation omitted/);
 const input=JSON.parse(conversationBody('gpt-6.1-terra',history,context(),[]).input[0].content);
 assert.equal(input.currentUserMessage,text);assert.match(input.currentUserMessage,/household size is 2/);
});

test('pending model suggestions cannot masquerade as completed context edit receipts',async()=>{
 const {validateConversationReply}=await import('../src/lib/guru/conversation');
 const reply={step:'discover',changes:{householdSize:'2'},reply:'Updated your household size to 2; nothing else changed.',proposedAction:'none',evidenceIds:[]};
 assert.throws(()=>validateConversationReply(reply,[]),/Premature context edit/);
 for(const text of ["I've updated your household size to 2.",'I changed your household size.','We have saved your new ZIP.'])assert.throws(()=>validateConversationReply({...reply,reply:text},[]));
 assert.equal(validateConversationReply({...reply,reply:'Please confirm household size 2. The earlier premium comparison needs renewed confirmation.'},[]).changes.householdSize,'2');
});
