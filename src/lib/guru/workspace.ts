import { z } from 'zod';
import { parseMarketplacePlanYear } from '../marketplace/states';
import { ticSourceCurrent } from '../tic/freshness';
import { STATE_MEDICAID_RESOURCES } from '../medicaid/states';

export const STEPS = ['discover', 'coverage', 'compare', 'how'] as const;
export type Step = typeof STEPS[number];
// The same supported registry drives app validation and the model's enum.
// Empty means explicitly unknown/cleared; null is unchanged in model output.
export const GURU_STATE_CODES=['',...STATE_MEDICAID_RESOURCES.map(s=>s.code)] as [string,...string[]];
const stateNames=new Map(STATE_MEDICAID_RESOURCES.flatMap(s=>[[s.code,s.code],[s.state.toUpperCase(),s.code]]));
export function normalizeExplicitState(value:string):string{
 const normalized=value.trim().replace(/\s+/g,' ').toUpperCase();
 if(normalized==='')return '';
 const code=stateNames.get(normalized);
 if(!code)throw Error('Unsupported explicit state suggestion');
 return code;
}
export const contextSchema = z.object({
  state: z.enum(GURU_STATE_CODES), zip: z.string().max(5), year: z.number().int(),
  age: z.string().max(3), income: z.string().max(12), householdSize: z.string().max(2),
  employment: z.enum(['unknown', 'working', 'not_working', 'retired']),
  employerOffer: z.enum(['unknown', 'offered', 'offered_household', 'none']),
  npi: z.string().max(10), planId: z.string().max(30), planIdType: z.enum(['ein', 'hios']),
  employerPremium: z.string().max(12), employerFrequency: z.enum(['monthly', 'weekly', 'biweekly', 'semimonthly']),
  marketplacePremium: z.string().max(12),
  premiumBasis: z.enum(['unknown','self','household']),
  comparison: z.enum(['employer','medicaid']),
  doctorQuery:z.string().max(120),employerQuery:z.string().max(120),planQuery:z.string().max(120),
}).strict();
export type GuruContext = z.infer<typeof contextSchema>;
export type Action = 'screen' | 'plans' | 'network' | 'premium';
export const ACTIONS=['screen','plans','network','premium'] as const;
export type Evidence = {
  action: Action; requestKey: string; observedAt: string; title: string;
  facts: Array<{label: string; value: string}>; notes: string[];
};
export function initialContext(year: number): GuruContext {
  return {state:'',zip:'',year,age:'',income:'',householdSize:'1',employment:'unknown',employerOffer:'unknown',
    npi:'',planId:'',planIdType:'ein',employerPremium:'',employerFrequency:'monthly',marketplacePremium:'',premiumBasis:'unknown',comparison:'employer',doctorQuery:'',employerQuery:'',planQuery:''};
}
/** Applies through every form, proposal and shared-context write path. */
export function reconcileContext(previous:GuruContext,next:GuruContext):GuruContext{
  return {...next,
    ...(previous.householdSize!==next.householdSize?{premiumBasis:'unknown' as const}:{}),
    ...(previous.doctorQuery!==next.doctorQuery?{npi:''}:{}),
    ...(previous.planQuery!==next.planQuery||previous.employerQuery!==next.employerQuery?{planId:''}:{}),
  };
}
export const CONTEXT_LABELS:Record<keyof GuruContext,string>={state:'State',zip:'ZIP code',year:'Marketplace coverage year',age:'Age',income:'Annual household income',householdSize:'Household size',employment:'Work situation',employerOffer:'Employer insurance offer',npi:'Doctor NPI',planId:'Plan or employer identifier',planIdType:'Identifier type',employerPremium:'Other option’s premium contribution',employerFrequency:'Contribution frequency',marketplacePremium:'Marketplace monthly premium',premiumBasis:'People covered by both amounts',comparison:'Comparison option',doctorQuery:'Doctor name to search',employerQuery:'Employer name to search',planQuery:'Plan name to search'};
export function contextValue(key:keyof GuruContext,value:unknown):string{
 const labels:Record<string,string>={unknown:'Not confirmed',working:'Working',not_working:'Not working',retired:'Retired',offered:'Offered to you',offered_household:'Offered through a household member',none:'No relevant employer offer',self:'You only',household:'The same household members',monthly:'Monthly',weekly:'Weekly',biweekly:'Every two weeks',semimonthly:'Twice a month',employer:'Employer offer',medicaid:'Medicaid',ein:'Employer EIN',hios:'HIOS plan identifier'};
 return labels[String(value)]??String(value);
}
export function missingQuestion(action:Action,c:GuruContext):string|null{
 if(action==='network')return !/^\d{10}$/.test(c.npi)?'What is your doctor’s name, and what ZIP or location should we search? Choose the matching doctor so we check the right person.':!c.planId?'What is your plan or employer’s name? We can help find the identifier, then you can confirm the matching option.':null;
 if(action==='premium')return !c.employerPremium.trim()?'What is the other option’s premium contribution and how often would you pay it?':!c.marketplacePremium.trim()?'What Marketplace monthly premium have you been quoted?':c.premiumBasis==='unknown'?'Do both premium amounts cover just you, or the same household members?':null;
 if(!c.state)return 'Which state do you need coverage in?';
 if(c.employerOffer==='unknown')return 'Has an employer actually offered insurance to you or someone in your household, or is that still unknown?';
 if(c.employerOffer!=='none')return null;
 return !c.zip?'What is your ZIP code?':!c.age?'How old will you be in the coverage year?':c.income===''?'What annual household income do you expect for that coverage year?':null;
}
/** A useful route, without pretending an offer review is an eligibility verdict. */
export function offerHandoff(c:GuruContext):Evidence|undefined{
 if(c.employerOffer==='none')return undefined;
 const unknown=c.employerOffer==='unknown';
 return {action:'screen',requestKey:requestKey('screen',c),observedAt:new Date().toISOString(),
  title:unknown?'Clarify the offer; keep your coverage routes open':'Keep Medicaid open and review the employer offer',
  facts:[{label:'Employer offer',value:contextValue('employerOffer',c.employerOffer)},{label:'Subsidized estimate',value:'Not calculated'},{label:'Source',value:'Official navigation and your stated situation'}],
  notes:[unknown?'Working does not establish an insurance offer. Confirm whether an offer exists, including through another household member.':'The official Marketplace can review the offer’s affordability and minimum value for each relevant household member.',
   'You can still use your state Medicaid application to check categories that may apply. An employer offer is not a finding that you cannot qualify.',
   'Use the official Medicaid and Marketplace links below. No eligibility or enrollment decision was made here.']};
}
const amount = (s: string) => s.trim() !== '' && /^\d+(?:\.\d{1,2})?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : undefined;
export const usd = (n: number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
/** Bind a result to the inputs that actually produced it, never a later edit. */
export function requestKey(action: Action, c: GuruContext) {
  const scope=[c.state,c.zip,c.year,c.householdSize];
  if(action==='network') return JSON.stringify([...scope,c.npi,c.planIdType,c.planId]);
  if(action==='premium') return JSON.stringify([...scope,c.employerPremium,c.employerFrequency,c.marketplacePremium,c.premiumBasis,c.comparison]);
  return JSON.stringify([c.state,c.zip,c.year,c.age,c.income,c.householdSize,c.employerOffer]);
}
export function actionInput(action: Action,c: GuruContext): Record<string,unknown> {
  contextSchema.parse(c);
  if(action==='network') {
    if(!/^\d{10}$/.test(c.npi)||!(c.planIdType==='ein'?/^\d{9}$/:/^[A-Za-z0-9-]{1,30}$/).test(c.planId)) throw Error('Enter the exact doctor NPI and employer EIN or HIOS plan identifier.');
    return {npi:c.npi,planIdType:c.planIdType,planId:c.planId};
  }
  if(action==='premium') return {};
  if(action==='plans'&&c.employerOffer!=='none') throw Error('An employer offer needs an affordability and minimum-value review. Use the official Marketplace before relying on a subsidy estimate. Working does not by itself answer whether you have an offer.');
  if(!/^[A-Z]{2}$/.test(c.state)||!/^\d{5}$/.test(c.zip)||parseMarketplacePlanYear(c.year)===undefined) throw Error('Choose a state, ZIP code and supported coverage year.');
  const age=Number(c.age),householdSize=Number(c.householdSize),income=amount(c.income);
  if(c.age.trim()===''||!Number.isInteger(age)||age<0||age>120||income===undefined||!Number.isInteger(householdSize)||householdSize<1||householdSize>12) throw Error('Enter your age, annual household income and household size. Zero income is valid.');
  return {state:c.state,zip:c.zip,year:c.year,age,income,householdSize,employerOffer:c.employerOffer};
}
export function comparePremiums(c: GuruContext): Evidence {
  const employer=amount(c.employerPremium),marketplace=amount(c.marketplacePremium);
  if(employer===undefined||marketplace===undefined) throw Error('Enter both premium amounts. An unknown premium is not zero.');
  if(c.premiumBasis==='unknown')throw Error('Confirm that both premium amounts cover the same people.');
  const periods=c.comparison==='medicaid'?12:{monthly:12,weekly:52,biweekly:26,semimonthly:24}[c.employerFrequency];
  return {action:'premium',requestKey:requestKey('premium',c),observedAt:new Date().toISOString(),title:'Premium comparison—not total care cost',
    facts:[{label:'Both amounts cover',value:c.premiumBasis==='self'?'You only':'The same household members'},{label:'Contribution period',value:c.comparison==='medicaid'?'monthly':c.employerFrequency},{label:c.comparison==='medicaid'?'Declared Medicaid premium / year':'Employer employee contribution / year',value:usd(employer*periods)},{label:'Marketplace premium / year',value:usd(marketplace*12)}],
    notes:['Source: the amounts you entered. Confirm the contribution period with your benefits document.',
      'This compares premiums only. Deductibles, out-of-pocket limits, care use, medications, employer contributions and network fit still need review.',
      'A Marketplace amount is not a confirmed subsidy. An employer offer can affect eligibility for savings; confirm with the official Marketplace.']};
}
export function suggestStep(message: string): Step {
  if(/doctor|network|drug|medication|medicare|coverage check/i.test(message))return 'coverage';
  if(workTransition(message)&&!/compar/i.test(message))return 'discover';
  if(/compar|premium|cost|paycheck|cheaper/i.test(message))return 'compare';
  if(/how|source|privacy|explain/i.test(message))return 'how';
  return 'discover';
}
export const STEP_REPLY: Record<Step,string> = {
  discover:'Let’s find your next coverage step. Confirm your situation on the right, including whether you actually have an employer offer. We can check Medicaid and Marketplace options without assuming that having a job rules either out.',
  coverage:'Let’s check care fit. An exact doctor and plan identifier lets us look for a dated issuer listing. Missing, stale or conflicting evidence stays unknown; it does not mean a doctor is out of network.',
  compare:'Let’s put the options side by side. Enter the employee contribution and its pay period, then the Marketplace monthly premium. We’ll separate known premiums from the care costs and eligibility questions still unresolved.',
  how:'The conversation helps organize the next step. The coverage tools supply the evidence and calculations. A listing is a source claim, and an eligibility estimate is not an official decision. You stay in control of what runs.',
};
function workTransition(message:string){
 return /\b(?:jobs?|roles?|employers?|employment|work)\b/i.test(message)&&/\b(?:transfer(?:ring)?|transition(?:ing)?|chang(?:e|es|ing)|switch(?:ing)?|new|start(?:ing)?|leav(?:e|ing)|lost|loss|end(?:ing)?)\b/i.test(message);
}
/** Useful source-independent next step when a conversation service is absent.
 * A role change does not establish a coverage change or known premiums. */
export function guidedReply(message:string,c:GuruContext,step:Step=suggestStep(message)){
 const reply=step==='discover'&&workTransition(message)
  ?'For a job or role transition, first ask your benefits administrator whether your insurance changes, when current coverage would end and when any new coverage would start. Keep dates, premiums and benefit terms unknown until confirmed. Has your benefits team confirmed whether the role change affects your insurance?'
  :missingQuestion(step==='coverage'?'network':step==='compare'?'premium':'screen',c)??STEP_REPLY[step];
 return {step,reply};
}
/** Render only known server fields. Model prose never substitutes for tool evidence. */
export function evidenceFrom(action: Exclude<Action,'premium'>,c: GuruContext,data: Record<string,unknown>): Evidence {
  const facts: Evidence['facts']=[],notes:string[]=[];
  const add=(label:string,value:unknown)=>{if(typeof value==='string'||typeof value==='number')facts.push({label,value:String(value)});};
  let title='Coverage evidence';
  if(action==='network') {
    const plan=data.plan as {idType?:unknown;id?:unknown}|undefined;
    if(data.npi!==c.npi||plan?.idType!==c.planIdType||plan?.id!==c.planId)throw Error('The returned doctor or plan identifier did not match your request.');
    if(!['yes','no','unknown'].includes(String(data.value)))throw Error('The source did not return a supported coverage answer.');
    // This selected-source index does not certify absence. A conflicting or
    // stale response cannot be promoted to positive by its headline alone.
    const current=data.evidenceStatus==='listed'&&typeof data.sourceUpdated==='string'&&ticSourceCurrent(data.sourceUpdated,new Date().toISOString());
    title=data.value==='yes'&&current?'Listed in the issuer file':'Coverage remains unknown';
    add('Doctor NPI',c.npi);add('Plan identifier',`${c.planIdType.toUpperCase()} ${c.planId}`);
    add('Source',data.source);add('Source date',data.sourceUpdated??'Not supplied');add('Evidence status',data.evidenceStatus);
    if(typeof data.sourceUrl==='string')try{const url=new URL(data.sourceUrl);if(url.protocol==='https:')add('Source file',url.origin+url.pathname);}catch{}
    if(typeof data.explanation==='string')notes.push(data.explanation);
    notes.push('Confirm the exact benefit option and effective year with the insurer and provider before enrollment. An employer EIN can map to several options. A dated source listing does not guarantee future-year coverage.');
  } else if(action==='screen') {
    if(data.year!==c.year)throw Error('The coverage year in the response did not match.');
    title=typeof data.headline==='string'?data.headline:'Official coverage handoff';
    add('Coverage year',data.year);add('Screening result',data.verdict);add('Source freshness',data.sourceFreshness??'See source checks');
    if(Array.isArray(data.nextSteps))notes.push(...data.nextSteps.filter((x):x is string=>typeof x==='string'));
    if(Array.isArray(data.notes))notes.push(...data.notes.filter((x):x is string=>typeof x==='string'));
    notes.push('Source: HealthCare.gov Marketplace API when available; otherwise the official state directory. This is screening, not an eligibility determination.');
  } else {
    if(data.year!==c.year||!Array.isArray(data.plans))throw Error('The plan response did not match this request.');
    title='Marketplace options for your confirmed inputs';add('Coverage year',data.year);add('County',data.county);add('Plans returned',data.totalPlans);
    for(const raw of data.plans.slice(0,5))if(raw&&typeof raw==='object'){
      const p=raw as Record<string,unknown>;
      add(`Plan ${String(p.id??'identifier missing')}`,`${String(p.name??'Name unavailable')} · monthly net premium ${typeof p.netPremiumMonthly==='number'?usd(p.netPremiumMonthly):'unknown'}`);
    }
    notes.push('Source: HealthCare.gov Marketplace API. Premiums are estimates, not full annual care spending. Use the full plan comparison to add doctors and medications.');
    if(Array.isArray(data.notes))notes.push(...data.notes.filter((x):x is string=>typeof x==='string'));
  }
  return {action,requestKey:requestKey(action,c),observedAt:new Date().toISOString(),title,facts,notes};
}
