import { z } from 'zod';
import { contextSchema, STEPS, reconcileContext, type GuruContext } from './workspace';
import { medicaidResourceByCode } from '../medicaid/states';
import { parseMarketplacePlanYear } from '../marketplace/states';

/** The model proposes context and navigation only. It cannot produce a coverage
 * label, a price, a source, an eligibility verdict or a completed action. */
export const proposalSchema=z.object({step:z.enum(STEPS),changes:contextSchema.partial()}).strict();
export type Proposal=z.infer<typeof proposalSchema>;
export function applyProposal(context:GuruContext,proposal:Proposal){
 const next=contextSchema.parse({...context,...proposalSchema.parse(proposal).changes});
 if((next.state&&!medicaidResourceByCode(next.state))||(next.zip&&!/^\d{5}$/.test(next.zip))||parseMarketplacePlanYear(next.year)===undefined)throw Error('Unsupported context suggestion');
 return reconcileContext(context,next);
}
