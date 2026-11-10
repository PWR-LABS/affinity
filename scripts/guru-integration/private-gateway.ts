/** Private loopback interactive review. User context may be real/private;
 * server-derived insurer evidence is synthetic and cannot establish real coverage.
 * No model key, phase or trusted evidence accepted from client.
 */
import {createServer,type Server} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {historySchema,type ReferencedEvidence} from '../../src/lib/guru/chat';
import {contextSchema,ACTIONS,comparePremiums,requestKey,type GuruContext} from '../../src/lib/guru/workspace';
import {conversationBody} from '../../src/lib/guru/conversation';
import {MODEL,SOURCE_COMMIT,hash,validateBound,runPrivateTurn} from './private-runtime';

const input=z.object({id:z.string().uuid(),history:historySchema.min(1),context:contextSchema,evidenceActions:z.array(z.enum(ACTIONS)).max(3)}).strict();
const disclosure='PRIVATE SYNTHETIC REVIEW: fictional source evidence; no live insurer lookup, eligibility determination or enrollment.';
export function reviewEvidence(actions:typeof ACTIONS[number][],context:GuruContext):ReferencedEvidence[]{
 return [...new Set(actions)].map(action=>{
  const common={id:`private-${action}`,action,requestKey:requestKey(action,context),observedAt:new Date().toISOString()};
  if(action==='premium'){
   const value=comparePremiums(context);
   return {...value,...common,title:'Private review: declared premium arithmetic',notes:[disclosure,...value.notes]};
  }
  const notes=[disclosure];
  const facts=[{label:'Source',value:'SYNTHETIC_REVIEW_FIXTURE'}];
  if(action==='network'){
   facts.push({label:'Doctor NPI',value:context.npi},{label:'Plan identifier',value:context.planIdType+':'+context.planId},{label:'Evidence status',value:'unknown'});
   notes.push('No real provider membership was checked. Do not infer a positive listing or exclusion. Confirm exact plan, benefit option and effective year through the insurer and provider.');
  }else notes.push('No live screening, subsidy or plan quote was requested. Keep official Medicaid and Marketplace review available; an employer offer requires official affordability/minimum-value review.');
  return {...common,title:'Private review: coverage remains unknown',facts,notes};
 });
}
export async function remainingInteractive(root:string){
 let text='';try{text=await readFile(path.join(root,'extension-events.jsonl'),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(text&&!text.endsWith('\n'))throw Error('Journal incomplete');
 const events=text.trim()?text.trim().split('\n').map(line=>JSON.parse(line)):[];
 const maximum=events.some(e=>e.kind==='allocation_amended')?8:10;
 return Math.max(0,maximum-events.filter(e=>e.kind==='reserved'&&e.request.phase==='interactive').length);
}
export function privateGateway(options:{root:string;key:string;manifestHash:string;verifySource:()=>Promise<void>;turn?:typeof runPrivateTurn;now?:()=>Date}):Server{
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status:number,data:unknown)=>{res.writeHead(status);res.end(JSON.stringify(data));};
  if(req.url==='/health'&&req.method==='GET'){send(200,{mode:'private-synthetic-review',modelCalls:false,uiInstalled:false});return;}
  if(req.url!=='/api/guru'||req.method!=='POST'){send(404,{error:'Private evaluation endpoint only'});return;}
  if(req.headers.origin!=='http://127.0.0.1:3013'){send(403,{error:'Use the private review proxy'});return;}
  try{
   let size=0;const chunks:Buffer[]=[];
   for await(const part of req){const b=Buffer.from(part);size+=b.length;if(size>16000){send(413,{error:'Review input too large'});return;}chunks.push(b);}
   const body=input.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   if(!body.history.findLast(m=>m.role==='you')||body.history.findLast(m=>m.role==='you')!.text.length>1500)throw Error('Current user message missing or too long');
   await options.verifySource();
   const evidence=reviewEvidence(body.evidenceActions,body.context);
   const modelBody=conversationBody(MODEL,body.history,body.context,evidence);validateBound(modelBody,options.now?.());
   const result=await(options.turn??runPrivateTurn)({root:options.root,key:options.key,request:{requestId:body.id,phase:'interactive',sourceCommit:SOURCE_COMMIT,manifestHash:options.manifestHash,requestHash:hash(modelBody),model:MODEL},history:body.history,context:body.context,evidence});
   send(200,{mode:'connected',reply:result.reply,evidence,review:{mode:'synthetic',disclosure,remainingTurns:await remainingInteractive(options.root)}});
  }catch{send(503,{mode:'guided',error:'Private review unavailable; preserve reservations and inspect the local checkpoint. No automatic retry.'});}
 });
}
