import {z} from 'zod';
import {requestKey,ACTIONS,type Action,type GuruContext,type Evidence} from './workspace';
import {proposalSchema} from './proposal';
export type Binding={action:Action;requestKey:string;fingerprint:string};
export type ChatMessage={role:'you'|'guru';text:string;bindings?:Binding[];kind?:'tool'|'model'|'guided'};
const bindingSchema=z.object({action:z.enum(ACTIONS),requestKey:z.string().max(500),fingerprint:z.string().max(60)}).strict();
export const historySchema=z.array(z.object({role:z.enum(['you','guru']),text:z.string().max(2000),superseded:z.boolean(),bindings:z.array(bindingSchema).max(3).optional()}).strict()).max(12);
export type History=z.infer<typeof historySchema>;
export type ReferencedEvidence=Evidence&{id:string};
export const conversationSchema=proposalSchema.extend({reply:z.string().min(1).max(2400),proposedAction:z.enum(['none',...ACTIONS]),evidenceIds:z.array(z.string()).max(4)}).strict();
export type ConversationReply=z.infer<typeof conversationSchema>;
export const referencedEvidenceSchema=z.object({id:z.string(),action:z.enum(ACTIONS),requestKey:z.string(),observedAt:z.string(),title:z.string(),facts:z.array(z.object({label:z.string(),value:z.string()})),notes:z.array(z.string())});
/** Version source-derived content, excluding the retrieval clock. This is a
 * change detector, not an authentication or cryptographic integrity claim. */
export function evidenceFingerprint(e:Evidence):string{
 const content=JSON.stringify([e.action,e.requestKey,e.title,e.facts,e.notes]);
 let a=2166136261,b=5381;
 for(let i=0;i<content.length;i++){a=Math.imul(a^content.charCodeAt(i),16777619);b=Math.imul(b,33)^content.charCodeAt(i);}
 return `${content.length}-${(a>>>0).toString(16)}-${(b>>>0).toString(16)}`;
}
export function bindEvidence(e:Evidence):Binding{return {action:e.action,requestKey:e.requestKey,fingerprint:evidenceFingerprint(e)};}
export function superseded(message:Pick<ChatMessage,'bindings'>,context:GuruContext,evidence:Evidence[]=[]){
 return Boolean(message.bindings?.some(b=>{
  if(b.requestKey!==requestKey(b.action,context))return true;
  const latest=evidence.find(e=>e.action===b.action&&e.requestKey===b.requestKey);
  return !latest||evidenceFingerprint(latest)!==b.fingerprint;
 }));
}
export function modelHistory(messages:ChatMessage[],context:GuruContext,evidence:Evidence[]=[]):History{
 const latestUser=messages.findLastIndex(m=>m.role==='you'),start=Math.max(0,messages.length-8);
 return messages.slice(start).map((m,i)=>({role:m.role,
  text:(i===0&&start>0?'[Earlier conversation omitted.] ':'')+m.text.slice(0,start+i===latestUser?1500:750),
  superseded:superseded(m,context,evidence),...(m.bindings?{bindings:m.bindings}:{})}));
}
