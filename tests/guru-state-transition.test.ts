import test from 'node:test';
import assert from 'node:assert/strict';
import {STATE_MEDICAID_RESOURCES} from '../src/lib/medicaid/states';
import {contextSchema,initialContext,normalizeExplicitState,suggestStep,guidedReply,missingQuestion} from '../src/lib/guru/workspace';
import {proposalSchema,applyProposal} from '../src/lib/guru/proposal';
import {plannerBody,parseProposal} from '../src/lib/guru/planner';
import {conversationBody,conversationTurn,validateConversationReply} from '../src/lib/guru/conversation';
import {modelHistory} from '../src/lib/guru/chat';
const context=()=>({...initialContext(2027),state:'OR',employment:'working' as const});
const synthetic='Fictional scenario: I am employed in Oregon and changing internal roles in 2026. Benefit dates, terms and premiums are unknown. What should I verify first?';
const wire=(value:unknown)=>({model:'gpt-6.1-terra',status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('model state enum and app validation share the supported registry',()=>{
 const c=context(),planner=plannerBody('gpt-6.1-terra',synthetic,c),conversation=conversationBody('gpt-6.1-terra',[{role:'you',text:synthetic,superseded:false}],c,[]);
 const expected=['',...STATE_MEDICAID_RESOURCES.map(s=>s.code),null];
 const p=planner.text.format.schema.properties.changes.properties.state as {enum:unknown[]};
 const chat=conversation.text.format.schema.properties.changes.properties.state as {enum:unknown[]};
 assert.deepEqual(p.enum,expected);assert.deepEqual(chat.enum,expected);
 for(const s of STATE_MEDICAID_RESOURCES){assert.equal(contextSchema.parse({...c,state:s.code}).state,s.code);assert.ok(!p.enum.includes(s.state));assert.equal(normalizeExplicitState(s.state),s.code);}
 assert.throws(()=>contextSchema.parse({...c,state:'ZZ'}));assert.throws(()=>contextSchema.parse({...c,state:'Oregon'}));
});
test('explicit supported full state names normalize through both shared proposal paths without applying an edit',()=>{
 const c=context();
 for(const [input,code] of [['Oregon','OR'],['or','OR'],['  North   Carolina ','NC'],['district of columbia','DC'],['','']]){
  const changes={state:input,year:2026};
  const planner=parseProposal(wire({step:'discover',changes}));
  const chat=validateConversationReply({step:'discover',changes,reply:'Please confirm these suggested details.',proposedAction:'none',evidenceIds:[]},[]);
  assert.equal(planner.changes.state,code);assert.equal(chat.changes.state,code);
  assert.equal(applyProposal(c,{step:chat.step,changes:chat.changes}).state,code);assert.equal(c.state,'OR');assert.equal(c.year,2027);
  assert.deepEqual(Object.keys(chat.changes).sort(),['state','year']);
 }
 for(const bad of ['Atlantis','ZZ','Portland','Oregon and Nevada','Ohio?']){
  assert.throws(()=>normalizeExplicitState(bad));
  const parsed=proposalSchema.safeParse({step:'discover',changes:{state:bad}});assert.equal(parsed.success,false);if(!parsed.success)assert.deepEqual(parsed.error.issues[0].path,['changes','state']);
  assert.throws(()=>validateConversationReply({step:'discover',changes:{state:bad},reply:'Pending suggestion.',proposedAction:'none',evidenceIds:[]},[]));
 }
});
test('a new fictional employment transition has useful discovery fallback without inferred benefit terms',()=>{
 const c=context(),before={...c};
 assert.equal(suggestStep(synthetic),'discover');
 const guided=guidedReply(synthetic,c);
 assert.equal(guided.step,'discover');assert.match(guided.reply,/benefits administrator/);assert.match(guided.reply,/coverage would end/);assert.match(guided.reply,/unknown until confirmed/);assert.ok(!guided.reply.includes('both premium amounts'));
 assert.deepEqual(c,before);assert.equal(c.employerOffer,'unknown');assert.equal(c.income,'');assert.equal(c.employerPremium,'');
 assert.equal(suggestStep('I am changing jobs. Can I keep my doctor?'),'coverage');
 assert.equal(suggestStep('Compare the premiums for my new employer offer.'),'compare');
 assert.match(missingQuestion('premium',c)!,/premium contribution/);
 assert.match(missingQuestion('premium',{...c,employerPremium:'0'})!,/Marketplace monthly premium/);
 assert.match(missingQuestion('premium',{...c,employerPremium:'0',marketplacePremium:'100'})!,/same household members/);
});
test('synthetic full-name adapter response is accepted once, stays pending and preserves budget order',async()=>{
 const c=context(),history=modelHistory([{role:'you',text:synthetic}],c,[]),calls:string[]=[];
 const reply=await conversationTurn({model:'gpt-6.1-terra',context:c,history,evidence:[],key:'synthetic',now:new Date('2026-11-10'),reserve:async()=>{calls.push('reserve');},fetcher:(async()=>{calls.push('dispatch');return Response.json(wire({step:'discover',changes:{state:'Oregon',year:2026,zip:null},reply:'Please confirm the state and year. Has your benefits administrator confirmed whether this role change changes your insurance?',proposedAction:'none',evidenceIds:[]}));}) as typeof fetch});
 assert.deepEqual(calls,['reserve','dispatch']);assert.equal(reply.changes.state,'OR');assert.equal(reply.changes.year,2026);assert.equal(c.year,2027);assert.equal(c.employerOffer,'unknown');
 assert.deepEqual(Object.keys(reply.changes).sort(),['state','year']);
});
