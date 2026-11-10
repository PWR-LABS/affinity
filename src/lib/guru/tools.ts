import {POST as eligibility} from '../../app/api/eligibility/route';
import {POST as plans} from '../../app/api/plans/route';
import {POST as network} from '../../app/api/tic/verify/route';
import {actionInput,comparePremiums,evidenceFrom,offerHandoff,requestKey,type Action,type GuruContext,type Evidence} from './workspace';
import type {ReferencedEvidence} from './chat';

/** Allowlisted read-only application tools. No arbitrary URLs or model-provided code. */
export async function executeAction(action:Action,context:GuruContext):Promise<Evidence>{
 if(action==='premium')return comparePremiums(context);
 if(action==='screen'){const handoff=offerHandoff(context);if(handoff)return handoff;}
 const body=actionInput(action,context);
 const response=await({screen:eligibility,plans,network}[action])(new Request('http://guru.internal/tool',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 const data=await response.json();
 if(!response.ok)throw Error('The requested evidence service is unavailable. Use the official handoff.');
 return evidenceFrom(action,context,data);
}
export async function currentEvidence(actions:Action[],context:GuruContext):Promise<ReferencedEvidence[]>{
 const output:ReferencedEvidence[]=[];
 for(const action of [...new Set(actions)].slice(0,3)){
  try{output.push({...await executeAction(action,context),id:`current-${action}`});}
  catch{output.push({id:`current-${action}`,action,requestKey:requestKey(action,context),observedAt:new Date().toISOString(),title:'Current evidence unavailable',facts:[{label:'Status',value:'Unknown; service or inputs require review'}],notes:['No current listing, price or eligibility can be inferred. Use the official handoff or correct the missing inputs.']});}
 }
 return output;
}
