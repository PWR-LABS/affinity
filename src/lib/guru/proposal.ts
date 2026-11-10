import { z } from 'zod';
import { contextSchema, STEPS, reconcileContext, normalizeExplicitState, type GuruContext } from './workspace';
import { medicaidResourceByCode } from '../medicaid/states';
import { parseMarketplacePlanYear } from '../marketplace/states';

/** The model proposes context and navigation only. It cannot produce a coverage
 * label, a price, a source, an eligibility verdict or a completed action. */
// Normalize only an explicitly proposed state. No ZIP/income/employment
// inference, fuzzy geographic match or mutation of confirmed context.
const changesSchema=z.preprocess((value,ctx)=>{
 if(value&&typeof value==='object'&&!Array.isArray(value)&&'state'in value&&typeof value.state==='string'){
  try{return {...value,state:normalizeExplicitState(value.state)};}
  catch{ctx.addIssue({code:z.ZodIssueCode.custom,path:['state'],message:'Unsupported explicit state suggestion'});return z.NEVER;}
 }
 return value;
},contextSchema.partial());
export const proposalSchema=z.object({step:z.enum(STEPS),changes:changesSchema}).strict();
export type Proposal=z.infer<typeof proposalSchema>;
export function applyProposal(context:GuruContext,proposal:Proposal){
 const next=contextSchema.parse({...context,...proposalSchema.parse(proposal).changes});
 if((next.state&&!medicaidResourceByCode(next.state))||(next.zip&&!/^\d{5}$/.test(next.zip))||parseMarketplacePlanYear(next.year)===undefined)throw Error('Unsupported context suggestion');
 return reconcileContext(context,next);
}
