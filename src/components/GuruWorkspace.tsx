'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { allowanceMessage, VISITOR_LIMITS } from '@/lib/guru/allowance';
import { STATE_MEDICAID_RESOURCES, medicaidResourceByCode } from '@/lib/medicaid/states';
import { DEFAULT_MARKETPLACE_PLAN_YEAR, SUPPORTED_MARKETPLACE_PLAN_YEARS, stateBasedMarketplace } from '@/lib/marketplace/states';
import { actionInput, comparePremiums, evidenceFrom, initialContext, requestKey, suggestTask, taskStep, guidedReply, missingQuestion, offerHandoff, CONTEXT_LABELS, GUIDED_HANDOFFS, contextValue, reconcileContext, type Action, type Evidence, type GuidedTask, type GuruContext, type Step } from '@/lib/guru/workspace';
import { applyProposal, type Proposal } from '@/lib/guru/proposal';
import { useGuruStore,useGuruMemory } from './GuruContext';
import { Typeahead,type Suggestion } from './Typeahead';
import { conversationSchema,referencedEvidenceSchema,modelHistory,superseded,bindEvidence,type ChatMessage } from '@/lib/guru/chat';

const ACTION_LABEL:Record<Action,string>={screen:'Check coverage routes',network:'Check this doctor and plan',plans:'Find Marketplace estimates',premium:'Compare these declared premiums'};
function selectionLabel(value:unknown,id:string,fallback:string){return value&&typeof value==='object'&&'id'in value&&'label'in value&&value.id===id?String(value.label):fallback;}
const LABEL:Record<Step,string>={discover:'Discover',coverage:'Coverage',compare:'Compare',how:'How'};
const CITATION_LABEL:Record<Action,string>={screen:'coverage routes',plans:'plan estimates',network:'issuer evidence',premium:'premium assumptions'};
const WORKBENCH_TITLES: Record<Step,string> = {
 discover:'Find coverage options',
 coverage:'Check whether you can keep your doctor',
 compare:'Compare the premiums you’d pay',
 how:'Confirm your coverage before enrolling',
};
function conversationText(message:ChatMessage,isOld:boolean){
 return message.text.split(/(\[(?:current|private)-(?:screen|plans|network|premium)\])/g).map((part,i)=>{
  const action=part.match(/^\[(?:current|private)-(screen|plans|network|premium)\]$/)?.[1] as Action|undefined;
  if(!action)return <span key={i}>{part.split(/(\*\*[^*\n]+\*\*)/g).map((text,j)=>text.startsWith('**')&&text.endsWith('**')?<strong key={j}>{text.slice(2,-2)}</strong>:text)}</span>;
  if(!message.bindings?.some(b=>b.action===action))return '[source unavailable]';
  return isOld?`[previous ${CITATION_LABEL[action]}]`:<a key={i} href={`#guru-evidence-${action}`} data-evidence-id={part.slice(1,-1)}>{CITATION_LABEL[action]}</a>;
 });
}

export function GuruWorkspace(){
 const store=useGuruStore();
 if(!store)throw Error('Guru workspace requires its context provider');
 const {context,setContext}=store;
 const current=useRef(context);current.current=context;
 const [task,setTask]=useGuruMemory<GuidedTask|null>('step',null);
 const handoff=task&&task in GUIDED_HANDOFFS?GUIDED_HANDOFFS[task as keyof typeof GUIDED_HANDOFFS]:null;
 const [draft,setDraft]=useState('');
 const [connected,setConnected]=useGuruMemory('connected',false);
 const [chatPending,setChatPending]=useState(false),[proposal,setProposal]=useState<Proposal|null>(null),[actionProposal,setActionProposal]=useState<Action|null>(null);
 const [availability,setAvailability]=useState<'unknown'|'ready'|'unavailable'>('unknown');
 const chatSequence=useRef(0),chatController=useRef<AbortController|null>(null);
 const [messages,setMessages]=useGuruMemory<ChatMessage[]>('conversation',[{role:'guru',text:'What would you like to work out about your coverage? Ask a question or try one of the examples below.'}]);
 const logRef=useRef<HTMLDivElement>(null);
 const questionRef=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(logRef.current)logRef.current.scrollTop=logRef.current.scrollHeight;},[messages]);
 const [evidence,setEvidence]=useGuruMemory<Evidence[]>('evidence',[]);
 const [error,setError]=useState(''),[pending,setPending]=useState<Action|null>(null);
 const sequence=useRef(0),controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>{controller.current?.abort();chatController.current?.abort();},[]);
 const [walkthrough,setWalkthrough]=useState(0);
 const answerRef=useRef<HTMLDivElement>(null);
 const workbenchRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(workbenchRef.current)workbenchRef.current.scrollTop=0;},[task]);
 function update<K extends keyof GuruContext>(key:K,value:GuruContext[K]){
  if(key==='planId'||key==='planIdType')store?.setMemory(old=>({...old,'network-plan':null}));
  const next=reconcileContext(current.current,{...current.current,[key]:value});current.current=next;setContext(next);
  chatSequence.current++;chatController.current?.abort();setChatPending(false);setProposal(null);setActionProposal(null);
  sequence.current++;controller.current?.abort();setPending(null);setError('');
  if(evidence.some(e=>e.requestKey!==requestKey(e.action,next)))say('Your inputs changed. I’ve cleared the affected results so an earlier answer cannot stand in for a new check.');
  setEvidence(old=>old.filter(e=>e.requestKey===requestKey(e.action,next)));
 }
 function say(text:string,bindings?:ChatMessage['bindings'],kind:ChatMessage['kind']='guided'){
  setMessages(old=>[...old.slice(-23),{role:'guru',text,bindings,kind}]);
 }
 async function respond(history:ChatMessage[],sourceEvidence:Evidence[],fallback:GuidedTask|null){
  const id=++chatSequence.current;chatController.current?.abort();setProposal(null);setActionProposal(null);
  const snapshot={...current.current},snapshotKey=JSON.stringify(snapshot),abort=new AbortController();chatController.current=abort;setChatPending(true);
  const latestQuestion=history.findLast(m=>m.role==='you')?.text??'';
  function continueGuided(notice:string){
   if(id!==chatSequence.current||snapshotKey!==JSON.stringify(current.current))return;
   setAvailability('unavailable');setTask(fallback);
   say(notice+' '+guidedReply(latestQuestion,snapshot,fallback).reply);
  }
  try{
   const actions=sourceEvidence.filter(e=>e.requestKey===requestKey(e.action,snapshot)).map(e=>e.action).slice(0,3);
   const response=await fetch('/api/guru',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),history:modelHistory(history,snapshot,sourceEvidence),context:snapshot,evidenceActions:actions}),signal:abort.signal});
   if(response.status===429){
    const limited=await response.json();
    if(limited.code==='guru_limit'&&['site','visitor','network'].includes(limited.scope)&&['minute','day','month'].includes(limited.window)){
     continueGuided(allowanceMessage(limited.scope,limited.window));
     return;
    }
   }
   if(!response.ok)throw Error('unavailable');
   const data=await response.json(),next=conversationSchema.parse(data.reply);
   const fresh=referencedEvidenceSchema.array().parse(data.evidence??[]);
   if(fresh.some(e=>e.requestKey!==requestKey(e.action,snapshot))||next.evidenceIds.some(id=>!fresh.some(e=>e.id===id)))throw Error('Evidence mismatch');
   if(id!==chatSequence.current||snapshotKey!==JSON.stringify(current.current))return;
   // Keep a specific estimate task when the model returns its broader comparison step.
   setAvailability('ready');setTask(fallback==='plans'&&next.step==='compare'?'plans':next.step);
   if(Object.keys(next.changes).length)setProposal({step:next.step,changes:next.changes});
   if(next.proposedAction!=='none')setActionProposal(next.proposedAction);
   setEvidence(old=>[...fresh,...old.filter(e=>!fresh.some(n=>n.action===e.action))]);
   say(next.reply,fresh.filter(e=>next.evidenceIds.includes(e.id)).map(bindEvidence),'model');
  }catch{continueGuided('Connected guru is unavailable for this turn. Your context is still here.');}
  finally{if(id===chatSequence.current)setChatPending(false);}
 }
 async function ask(text:string){
  if(!text.trim())return;
  const nextTask=suggestTask(text,task);
  chatSequence.current++;chatController.current?.abort();setChatPending(false);setProposal(null);setActionProposal(null);
  sequence.current++;controller.current?.abort();setPending(null);
  setDraft('');setError('');setWalkthrough(0);
  const history:ChatMessage[]=[...messages.slice(-23),{role:'you',text:text.trim().slice(0,1500)}];setMessages(history);
  if(connected&&!(nextTask&&nextTask in GUIDED_HANDOFFS)){await respond(history,evidence,nextTask);return;}
  setTask(nextTask);
  say(guidedReply(text,current.current,nextTask).reply);
 }
 async function run(action:Action){
  const snapshot={...current.current},id=++sequence.current;controller.current?.abort();
  chatSequence.current++;chatController.current?.abort();setChatPending(false);setProposal(null);setActionProposal(null);
  const abort=new AbortController();controller.current=abort;setPending(action);setError('');
  try{
   const handoff=(action==='screen'||action==='plans')&&snapshot.state?offerHandoff(snapshot,action):undefined;
   let result:Evidence;
   if(handoff)result=handoff;
   else{
    const question=missingQuestion(action,snapshot);
    if(question){setError(question);say(question);return;}
    const input=actionInput(action,snapshot);
    if(action==='premium')result=comparePremiums(snapshot);
    else{
     const path={screen:'/api/eligibility',plans:'/api/plans',network:'/api/tic/verify'}[action];
     const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:abort.signal});
     const raw:unknown=await response.json().catch(()=>null);
     if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('The coverage service returned an unreadable result. Please try again.');
     const data=raw as Record<string,unknown>;
     if(!response.ok)throw Error(typeof data.error==='string'?data.error:'The coverage service is unavailable. Use the official handoff below.');
     result=evidenceFrom(action,snapshot,data);
    }
   }
   if(id!==sequence.current||result.requestKey!==requestKey(result.action,current.current))return;
   const fresh=[result,...evidence.filter(e=>e.action!==result.action)];setEvidence(fresh);
   const note=(action==='screen'||action==='plans')&&snapshot.employerOffer==='unknown'?missingQuestion(action,snapshot):result.notes[0];
   const message:ChatMessage={role:'guru',text:result.title.trim().replace(/[.!?]?$/,'.')+' '+(note??'Review the source and next step below.'),bindings:[bindEvidence(result)],kind:'tool'};
   const history=[...messages.slice(-23),message];setMessages(history);answerRef.current?.focus();
   if(connected)await respond(history,fresh,task);
  }catch(e){if(id===sequence.current){
   setEvidence(old=>old.filter(item=>item.action!==action));
   setError(e instanceof Error&&e.name!=='TypeError'?e.message:'The coverage service could not be reached. Try again or use the official resource.');
  }}
  finally{if(id===sequence.current)setPending(null);}
 }
 function clear(){store?.setMemory({});sequence.current++;chatSequence.current++;controller.current?.abort();chatController.current?.abort();setProposal(null);setActionProposal(null);setAvailability('unknown');setChatPending(false);const next=initialContext(DEFAULT_MARKETPLACE_PLAN_YEAR);current.current=next;setContext(next);setEvidence([]);setPending(null);setError('');setDraft('');setTask(null);setWalkthrough(0);setMessages([{role:'guru',text:'This workspace is cleared. What would you like to work out next?'}]);}
 function confirmProposal(){if(!proposal)return;try{const next=applyProposal(current.current,proposal);store?.setMemory(old=>({...old,'network-plan':null}));sequence.current++;controller.current?.abort();current.current=next;setContext(next);setEvidence(old=>old.filter(e=>e.requestKey===requestKey(e.action,next)));setPending(null);setProposal(null);say('Your confirmed edits are applied. Run the relevant check to get evidence for this context.');}catch{setError('This suggestion contains unsupported inputs. Please enter the correction in the form.');setProposal(null);}}
 const field=(key:'zip'|'age'|'income'|'householdSize'|'npi'|'planId'|'employerPremium'|'marketplacePremium',label:string,hint?:string)=> <div className="field" key={key}>
  <label htmlFor={`guru-${key}`}>{label}</label><input id={`guru-${key}`} value={context[key]} inputMode={key==='planId'?'text':'decimal'} maxLength={{zip:5,age:3,income:12,householdSize:2,npi:10,planId:30,employerPremium:12,marketplacePremium:12}[key]} onChange={e=>update(key,e.target.value)} />
  {hint&&<p className="field-help">{hint}</p>}
 </div>;
 const fetchDoctorChoices=useCallback(async(q:string,signal?:AbortSignal):Promise<Suggestion[]>=>{
  if(!/^\d{5}$/.test(context.zip))return [];
  const r=await fetch('/api/providers/autocomplete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({q,zip:context.zip,year:context.year}),signal});
  if(!r.ok)throw Error('Doctor search unavailable');
  const data=await r.json();
  return (data.items??[]).map((p:{npi:string;name?:string;specialty?:string})=>({key:p.npi,label:p.name??p.npi,sub:p.specialty}));
 },[context.zip,context.year]);
 const fetchEmployerChoices=useCallback(async(q:string,signal?:AbortSignal):Promise<Suggestion[]>=>{
  const r=await fetch('/api/employers/search?q='+encodeURIComponent(q),{signal});if(!r.ok)throw Error('Employer search unavailable');
  const data=await r.json();return(data.items??[]).map((e:{ein:string;name:string;state?:string})=>({key:e.ein,label:e.name,sub:[e.state,'Employer identity—not an exact benefit option'].filter(Boolean).join(' · ')}));
 },[]);
 const fetchPlanChoices=useCallback(async(q:string,signal?:AbortSignal):Promise<Suggestion[]>=>{
  const r=await fetch('/api/tic/plans?q='+encodeURIComponent(q),{signal});if(!r.ok)throw Error('Plan search unavailable');
  const data=await r.json();return(data.items??[]).map((p:{planIdType:string;planId:string;planName:string;issuer:string})=>({key:JSON.stringify([p.planIdType,p.planId]),label:p.planName||'Plan name not supplied',sub:p.issuer}));
 },[]);
 function selected(text:string){
  const history:ChatMessage[]=[...messages.slice(-23),{role:'guru',text:'Selection confirmed: '+text,kind:'guided'}];setMessages(history);
  if(connected)void respond(history,evidence,'coverage');
 }
 const resource=medicaidResourceByCode(context.state);
 const marketplace=stateBasedMarketplace(context.state,context.year);
 const activeEvidence=evidence.filter(e=>e.requestKey===requestKey(e.action,context));
 const canSearchDoctor=/^\d{5}$/.test(context.zip);
 const yearField=<div className="field"><label htmlFor="guru-year">Coverage year</label><select id="guru-year" value={context.year} onChange={e=>update('year',Number(e.target.value))}>{SUPPORTED_MARKETPLACE_PLAN_YEARS.map(y=><option key={y}>{y}</option>)}</select></div>;
 const routeFields=<>
  <div className="field"><label htmlFor="guru-state">State</label><select id="guru-state" value={context.state} onChange={e=>update('state',e.target.value)}><option value="">Choose your state</option>{STATE_MEDICAID_RESOURCES.map(s=><option value={s.code} key={s.code}>{s.state}</option>)}</select></div>
  {field('zip','ZIP code')}{yearField}{field('age','Your age')}
  {field('income','Annual household income ($)','An estimate is fine. Zero is valid.')}{field('householdSize','People in your household')}
  <div className="field"><label htmlFor="guru-employment">Work situation</label><select id="guru-employment" value={context.employment} onChange={e=>update('employment',e.target.value as GuruContext['employment'])}><option value="unknown">Not specified</option><option value="working">Working</option><option value="not_working">Not working</option><option value="retired">Retired</option></select></div>
  <div className="field"><label htmlFor="guru-offer">Employer insurance offer</label><select id="guru-offer" value={context.employerOffer} onChange={e=>update('employerOffer',e.target.value as GuruContext['employerOffer'])}><option value="unknown">Not sure yet</option><option value="none">No offer for anyone seeking coverage</option><option value="offered">Offered to me</option><option value="offered_household">Offered through a household member</option></select></div>
 </>;
 return <div className="guru-workspace">
  <header className="guru-heading">
   <p className="guru-eyebrow">Health coverage, step by step</p>
   <h1 className="page-title">Work it out with <span>guru.</span></h1>
   <p className="page-subtitle">Find coverage options, see if you can keep your doctor, and compare what you’d pay.</p>
  </header>
  <div className="guru-layout">
   <section className="guru-conversation page-panel" id="guru-conversation" aria-labelledby="guru-conversation-title" tabIndex={-1}>
    <div className="guru-section-heading"><h2 id="guru-conversation-title">Let’s start with you</h2><span className="guru-mode">{connected?(chatPending?'Thinking…':availability==='ready'?'Connected guru':availability==='unavailable'?'Guided fallback':'Connected guru requested'):'Guided mode'}</span></div>
    <div ref={logRef} className="guru-messages" role="log" aria-live="polite" aria-label="Conversation with guru" tabIndex={0}>
     {messages.map((message,index)=>{
      const isOld=superseded(message,context,evidence);
      const speaker=message.role==='you'?'You':isOld?'guru · superseded result':message.kind==='model'?'guru · AI explanation':'guru';
      return <div key={index} data-superseded={isOld} className={`guru-message guru-message-${message.role}`}>
       <strong className="guru-message-speaker">{speaker}</strong>
       <p className="guru-message-body">{conversationText(message,isOld)}</p>
       {isOld&&<p className="field-help">Earlier context—this answer is superseded. The inputs or current source evidence changed. Review the latest result or run a new check.</p>}
       {!isOld&&!!message.bindings?.length&&<p className="field-help">Evidence: {message.bindings.map(b=><a key={b.action} href={`#guru-evidence-${b.action}`} data-evidence-id={`current-${b.action}`}>{LABEL[b.action==='network'?'coverage':b.action==='premium'?'compare':'discover']} · current result </a>)}</p>}
      </div>;
     })}
    </div>
    {!task&&!chatPending&&<div className="guru-suggestions">{['I lost Medicaid','Can I keep my doctor?','Compare my employer offer'].map(text=><button type="button" key={text} onClick={()=>{void ask(text);questionRef.current?.focus({preventScroll:true});}}>{text}</button>)}</div>}
    <form className="guru-composer" onSubmit={e=>{e.preventDefault();ask(draft);}}>
     <label htmlFor="guru-question">What would you like to work out?</label>
     <textarea ref={questionRef} id="guru-question" value={draft} maxLength={1500} rows={2} onChange={e=>setDraft(e.target.value)} placeholder="I work part time. What are my coverage options?"/>
     <button className="primary" type="submit" disabled={!draft.trim()||chatPending}>{chatPending?'Thinking…':'Send to guru'}</button>
    </form>
    {task&&<a className="guru-pane-link" href="#guru-workbench">Continue in the coverage workspace ↓</a>}
    <div className="guru-conversation-footer">
     <div className="guru-conversation-controls">
      <label className="guru-ai-choice">
       <input type="checkbox" checked={connected} aria-describedby="guru-data-flow" onChange={e=>{setConnected(e.target.checked);chatSequence.current++;chatController.current?.abort();setChatPending(false);setProposal(null);setActionProposal(null);}}/>
       Use connected guru
      </label>
      <button className="guru-clear btn-text" type="button" onClick={clear}>Clear this workspace</button>
     </div>
     <p className="field-help" id="guru-data-flow">When enabled, recent chat, confirmed inputs, and relevant tool evidence are sent to OpenAI. You confirm suggested edits and checks. <Link href="/privacy">Data flow</Link>.</p>
     <details className="guru-ai-details">
      <summary>AI limits and guided mode</summary>
      <p className="field-help">Connected guru explains source-derived evidence using AI. Allowance is {VISITOR_LIMITS.day} replies per day and {VISITOR_LIMITS.month} per month per browser (UTC), with short burst and shared-network limits. Guided tools remain available.</p>
     </details>
     <p className="field-help">This workspace resets when you refresh or close this tab.</p>
    </div>
   </section>
   <section className="guru-workbench page-panel" id="guru-workbench" aria-labelledby="guru-workbench-title" tabIndex={-1}>
    <h2 id="guru-workbench-title">Your coverage workspace</h2>
    <div ref={workbenchRef} className="guru-workbench-content" role="region" aria-label="Coverage guidance" tabIndex={0}>
    <a className="guru-pane-link" href="#guru-conversation">↑ Back to guru chat</a>
    {task?<div className="guru-current-task"><h3>{handoff?.title??(task==='plans'?'Find Marketplace premium estimates':WORKBENCH_TITLES[taskStep(task)])}</h3></div>:<div className="guru-current-task">
     <h3>{chatPending?'Waiting for guru…':'Start with a question'}</h3>
     <p>Once you send a message, this workspace will show what to check, what information you need, and any results.</p>
    </div>}
    {proposal&&<aside className="guru-note"><h3>Review suggested context edits</h3><dl>{Object.entries(proposal.changes).map(([key,value])=><div key={key}><dt>{CONTEXT_LABELS[key as keyof GuruContext]}</dt><dd>{contextValue(key as keyof GuruContext,value)}</dd></div>)}</dl><button type="button" onClick={confirmProposal}>Confirm suggested edits</button><button type="button" onClick={()=>setProposal(null)}>Dismiss</button></aside>}
    {actionProposal&&<aside className="guru-note"><h3>Suggested check</h3><p>{ACTION_LABEL[actionProposal]}. No check has run from this suggestion.</p>{proposal?<p>Confirm or dismiss the context edits first.</p>:<button className="primary" type="button" disabled={pending!==null||chatPending} onClick={()=>run(actionProposal)}>Confirm and run: {ACTION_LABEL[actionProposal]}</button>}<button type="button" onClick={()=>setActionProposal(null)}>Dismiss check</button></aside>}
    {handoff&&<div className="guru-step-content">
      <p>{handoff.reply}</p>
      <div className="guru-actions">{handoff.links.map(([label,href])=>href.startsWith('/')?<Link key={href} href={href}>{label}</Link>:<a key={href} href={href}>{label}</a>)}</div>
    </div>}
    {task==='discover'&&<div className="guru-step-content">
     <p>Tell us where you need coverage and whether an employer actually offered you insurance. Then check which routes you can explore.</p>
     <div className="guru-fields">{routeFields}</div>
     {context.employerOffer!=='none'&&<p className="guru-note">You can still explore Medicaid and compare declared costs. The official Marketplace must review an offer’s affordability and minimum value before you rely on subsidized prices.</p>}
     {actionProposal!=='screen'&&<div className="guru-actions"><button className="primary" type="button" disabled={pending!==null} onClick={()=>run('screen')}>Check Medicaid / Marketplace routes</button></div>}
    </div>}
    {task==='coverage'&&<div className="guru-step-content">
     <p>Enter a ZIP code to search for your doctor. Then choose the specific plan or employer you want to check.</p>
     <div className="guru-fields">{field('zip','ZIP code')}{yearField}</div>
     <div className="guru-fields">
     {canSearchDoctor&&<div className="guru-doctor-field"><Typeahead key={`doctor-${context.zip}-${context.year}-${context.doctorQuery}`} label="Find your doctor by name" placeholder="Doctor name" initialQuery={context.doctorQuery} onQueryChange={()=>{if(current.current.npi)update('npi','');}} fetchSuggestions={fetchDoctorChoices} onSelect={s=>{update('npi',s.key);store?.setMemory(old=>({...old,'selected-doctor-label':{id:s.key,label:s.label}}));selected(`${s.label}, doctor identifier ${s.key}.`);}} />{context.npi&&<p className="field-help">Selected: {selectionLabel(store.memory['selected-doctor-label'],context.npi,'your doctor')} · {context.npi}</p>}</div>}
     <div><Typeahead key={`employer-${context.employerQuery}`} label="Find your employer" placeholder="Employer name" initialQuery={context.employerQuery} onQueryChange={()=>{if(current.current.planId)update('planId','');}} fetchSuggestions={fetchEmployerChoices} onSelect={s=>{update('planIdType','ein');update('planId',s.key);store?.setMemory(old=>({...old,'selected-plan-label':{id:current.current.planIdType+':'+s.key,label:s.label}}));selected(`${s.label}, employer identity ${s.key}. The actual benefit option still needs confirmation.`);}} /></div>
     <div><Typeahead key={`plan-${context.planQuery}`} label="Or find your plan by name" placeholder="Plan or network name" initialQuery={context.planQuery} onQueryChange={()=>{if(current.current.planId)update('planId','');}} fetchSuggestions={fetchPlanChoices} onSelect={s=>{const [type,id]=JSON.parse(s.key);update('planIdType',type);update('planId',id);store?.setMemory(old=>({...old,'selected-plan-label':{id:type+':'+id,label:s.label}}));selected(`${s.label}, identifier ${id}.`);}} />{context.planId&&<p className="field-help">Selected: {selectionLabel(store.memory['selected-plan-label'],context.planIdType+':'+context.planId,'your plan / employer')} · {context.planIdType.toUpperCase()} {context.planId}</p>}</div>
     </div>
     <details className="guru-task-details"><summary>Use exact identifiers instead</summary><div className="guru-fields">{field('npi','Doctor NPI','10 digits; look it up in the full coverage tool if needed.')}<div className="field"><label htmlFor="guru-plan-type">Identifier type</label><select id="guru-plan-type" value={context.planIdType} onChange={e=>update('planIdType',e.target.value as GuruContext['planIdType'])}><option value="ein">Employer EIN</option><option value="hios">HIOS plan identifier</option></select></div>{field('planId','Plan / employer identifier')}</div></details>
     <p>Coverage year is used for the doctor search. Confirm your exact benefit option and effective year with the insurer.</p>
     <div className="guru-actions">
      {actionProposal!=='network'&&<button className="primary" type="button" disabled={pending!==null} onClick={()=>run('network')}>Check issuer evidence</button>}
      <Link href="/verify">Find my doctor or employer</Link>
      <Link href="/verify/medicare-drug">Check a Medicare Part D medication</Link>
     </div>
     <p className="field-help">Medicare eligibility and enrollment need an official review. The Part D tool checks an individual plan’s drug coverage.</p>
    </div>}
    {task==='compare'&&<div className="guru-step-content">
     <p>Use the amount you’d pay for each option. Confirm that both premiums cover the same people.</p>
     <div className="field"><label htmlFor="guru-comparison">Compare with Marketplace</label><select id="guru-comparison" value={context.comparison} onChange={e=>{update('comparison',e.target.value as GuruContext['comparison']);update('employerPremium','');}}><option value="employer">Employer offer</option><option value="medicaid">Medicaid</option></select></div>
     <div className="guru-fields">
      {field('employerPremium',context.comparison==='medicaid'?'Confirmed Medicaid monthly premium ($)':'Employer employee contribution ($)',context.comparison==='medicaid'?'Confirm your eligibility and the state’s actual costs.':'Use the amount deducted from your pay.')}
      <div className="field"><label htmlFor="guru-frequency">Contribution frequency</label><select id="guru-frequency" disabled={context.comparison==='medicaid'} value={context.comparison==='medicaid'?'monthly':context.employerFrequency} onChange={e=>update('employerFrequency',e.target.value as GuruContext['employerFrequency'])}><option value="monthly">Monthly (12)</option><option value="weekly">Weekly (52)</option><option value="biweekly">Every two weeks (26)</option><option value="semimonthly">Twice a month (24)</option></select></div>
      {field('marketplacePremium','Marketplace monthly premium ($)')}
      <div className="field"><label htmlFor="guru-basis">Both amounts cover</label><select id="guru-basis" value={context.premiumBasis} onChange={e=>update('premiumBasis',e.target.value as GuruContext['premiumBasis'])}><option value="unknown">Not confirmed</option><option value="self">Me only</option><option value="household">The same household members</option></select></div>
     </div>
     {actionProposal!=='premium'&&<div className="guru-actions"><button className="primary" type="button" disabled={pending!==null} onClick={()=>run('premium')}>Compare declared premiums</button></div>}
     <details className="guru-task-details">
      <summary>Get a Marketplace estimate</summary>
      <p>Enter the details needed to estimate a Marketplace premium.</p>
      <div className="guru-fields">{routeFields}</div>
      <div className="guru-actions">
       {actionProposal!=='plans'&&<button type="button" disabled={pending!==null} onClick={()=>run('plans')}>Find Marketplace estimates</button>}
       <Link href="/plans">Full plan board with doctors and medications</Link>
      </div>
     </details>
    </div>}
    {task==='plans'&&<div className="guru-step-content">
     <p>Use your coverage year, ZIP code and household details to check available Marketplace estimates.</p>
     <div className="guru-fields">{routeFields}</div>
     <div className="guru-actions">
      {actionProposal!=='plans'&&<button className="primary" type="button" disabled={pending!==null} onClick={()=>run('plans')}>Find Marketplace estimates</button>}
      <Link href="/plans">Full plan board with doctors and medications</Link>
     </div>
    </div>}
    {task==='how'&&<div className="guru-step-content"><ol className="guru-walkthrough">{['Confirm the exact coverage option, people covered and effective year.','Check the insurer’s current network and formulary with your doctor and pharmacy.','Confirm eligibility, savings and enrollment deadlines with the official service before changing coverage.'].map((text,i)=><li key={text} aria-current={walkthrough===i?'step':undefined}>{text}</li>)}</ol><div className="guru-actions"><button type="button" onClick={()=>setWalkthrough((walkthrough+1)%3)}>{walkthrough===2?'Replay walkthrough':'Next confirmation'}</button><Link href="/how-it-works">Read how the evidence works</Link><Link href="/sources">Sources and freshness</Link></div><p>Missing evidence stays unknown. Conflicting or stale sources require confirmation; counting sources does not settle the conflict.</p></div>}
    {pending&&<p role="status">Checking {pending==='network'?'issuer evidence':'your coverage inputs'}…</p>}
    {error&&<p className="elig-error" role="alert">{error}</p>}
    <div ref={answerRef} tabIndex={-1} className="guru-evidence" aria-label="Evidence and next steps">{activeEvidence.map(e=><article key={e.action} id={`guru-evidence-${e.action}`}><p className="guru-eyebrow">{e.action==='premium'?'Your stated assumptions':'Tool result'}</p><h3>{e.title}</h3><dl>{e.facts.map((f,i)=><div key={i}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl><p className="field-help">Checked {new Date(e.observedAt).toLocaleString()}. This lookup time does not renew a source’s date.</p><ul>{e.notes.map((n,i)=><li key={i}>{n}</li>)}</ul></article>)}</div>
    <aside className="guru-handoff"><h3>Official enrollment resources</h3><div className="guru-actions">{resource&&<a href={resource.applyUrl} target="_blank" rel="noreferrer">{resource.program}</a>}<a href={marketplace?`https://${marketplace.url}`:'https://www.healthcare.gov/'} target="_blank" rel="noreferrer">{marketplace?.name??'HealthCare.gov'}</a><a href="https://www.medicare.gov/" target="_blank" rel="noreferrer">Medicare.gov</a>{!resource&&<Link href="/medicaid">Find your state Medicaid program</Link>}</div></aside>
    </div>
   </section>
  </div>
 </div>;
}
