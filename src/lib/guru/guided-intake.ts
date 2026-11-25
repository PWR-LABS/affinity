import { parseMarketplacePlanYear } from '../marketplace/states';
import { normalizeExplicitState, reconcileContext, type GuruContext } from './workspace';

type IntakeField = 'state' | 'zip' | 'age' | 'income' | 'householdSize' | 'employerOffer' | 'doctorQuery' | 'employerPremium' | 'marketplacePremium' | 'premiumBasis';

function askedField(question: string): IntakeField | undefined {
 const lastQuestion = question.match(/(?:^|[.?!]\s+)([^.?!]+\?)\s*$/)?.[1] ?? question;
 const prompts: Array<[IntakeField, RegExp]> = [
  ['state', /\b(?:which|what)\s+(?:u\.s\.\s+)?state\b/i],
  ['zip', /\b(?:zip|postal)\s+code\b/i],
  ['age', /\b(?:how old|(?:your|coverage year) age|age will you)\b/i],
  ['income', /\b(?:household income|income do you expect)\b/i],
  ['householdSize', /\b(?:how many people|household size)\b/i],
  ['employerOffer', /(?:actually offered|(?:an|any) employer offer).*(?:household|anyone)\b/i],
  ['doctorQuery', /\b(?:doctor|specialist)(?:’|')s name\b/i],
  ['employerPremium', /\b(?:monthly premium has the state|other option(?:’|')s premium contribution)\b/i],
  ['marketplacePremium', /\bmarketplace monthly premium\b/i],
  ['premiumBasis', /\bboth premium amounts cover\b/i],
 ];
 const matching = prompts.filter(([, pattern]) => pattern.test(lastQuestion));
 return matching.length === 1 ? matching[0][0] : undefined;
}

function money(text: string) {
 const match = text.trim().match(/^\$?\s*((?:\d{1,8}|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?|\d{1,5}(?:\.\d{1,2})?k)(?:\s*(?:per year|annually|a year))?$/i);
 if (!match) return undefined;
 const raw = match[1].replace(/,/g, '');
 const value = /k$/i.test(raw) ? Number(raw.slice(0, -1)) * 1000 : Number(raw);
 return Number.isFinite(value) && value <= 100_000_000 ? String(Math.round(value * 100) / 100) : undefined;
}

/** Update only explicit facts or strict answers to a single prior question. */
export function guidedContext(previous: GuruContext, message: string, question: string): GuruContext {
 const text = message.trim();
 // Treat explicit statements before a follow-up as answers, but never read
 // a question by itself as a factual assertion.
 const statement = text.endsWith('?') ? text.match(/^([\s\S]*[.!])\s+[^.?!]+\?$/)?.[1] ?? '' : text;
 const answer = statement.replace(/[.!]+$/, '').trim();
 if (!answer || answer.includes('?')) return previous;
 const expected = askedField(question);
 const next = { ...previous };
 const zip = answer.match(/\b(?:my\s+)?zip(?:\s+code)?(?:\s+is|\s*:)?\s+(\d{5})\b/i)?.[1]
  ?? (expected === 'zip' && /^\d{5}$/.test(answer) ? answer : undefined);
 const state = answer.match(/\b(?:i (?:live|need coverage|am located|am) in|i'm in|my state is|state\s*:)\s*([a-z ]+?)(?=,|;|\s+and\b|$)/i)?.[1]
  ?? (expected === 'state' ? answer : undefined);
 if (state) {
  try {
   const recognized = normalizeExplicitState(state);
   if (recognized) {
    if (next.state && next.state !== recognized && !zip) next.zip = '';
    next.state = recognized;
   }
  } catch { /* Unrecognized or ambiguous locations stay unfilled. */ }
 }
 if (zip) next.zip = zip;

 const age = answer.match(/\b(?:i am|i'm|my age is|age\s*:)\s*(\d{1,3})(?:\s+years?\s+old)?(?=\s*(?:$|,|;|and\b))/i)?.[1]
  ?? answer.match(/^\s*(\d{1,3})\s+years?\s+old$/i)?.[1]
  ?? (expected === 'age' && /^\d{1,3}$/.test(answer) ? answer : undefined);
 if (age !== undefined && Number(age) <= 120) next.age = String(Number(age));

 const household = answer.match(/\b(?:a\s+)?household of\s+(\d{1,2})\b|\b(?:household size is|household size\s*:)\s*(\d{1,2})\b/i);
 const size = household?.[1] ?? household?.[2] ?? (expected === 'householdSize' && /^\d{1,2}$/.test(answer) ? answer : undefined);
 if (size && Number(size) >= 1 && Number(size) <= 12) next.householdSize = String(Number(size));

 const annual = answer.match(/\b(?:annual household income|household income)(?:\s+is|\s*:)?\s*(\$?[\d,.]+\s*[kK]?)/i)?.[1];
 const income = annual ? money(annual) : expected === 'income' ? money(answer) : undefined;
 if (income !== undefined) next.income = income;

 const year = answer.match(/\b(?:coverage year|plan year|coverage for|plans for)(?:\s+is|\s*:)?\s*(20\d{2})\b/i)?.[1];
 if (year && parseMarketplacePlanYear(Number(year)) !== undefined) next.year = Number(year);

 if (/^(?:i am|i'm) retired$/i.test(answer)) next.employment = 'retired';
 else if (/^(?:i am|i'm) (?:not working|unemployed)$/i.test(answer)) next.employment = 'not_working';
 else if (/^(?:i work(?:\s+(?:part|full)[ -]time)?|i am working|i'm working)(?:$|\s*[,;.!]|\s+and\b)/i.test(answer)) next.employment = 'working';

 if (/^(?:no (?:relevant )?employer offer(?: for anyone(?: in (?:my|our) household| seeking coverage)?)?|no one in (?:my|our) household has an employer offer)$/i.test(answer) ||
     (expected === 'employerOffer' && /^(?:no|none|no one|nope)$/i.test(answer))) next.employerOffer = 'none';
 else if (/^(?:my employer|my job) (?:offers me|offered me) (?:insurance|coverage|health insurance)$/i.test(answer)) next.employerOffer = 'offered';
 else if (/^i (?:have|was offered) coverage through my (?:spouse|partner)(?:'s employer|'s job)$/i.test(answer)) next.employerOffer = 'offered_household';

 const doctor = answer.match(/^my (?:doctor|specialist)(?:'s name)? is (.+)$/i)?.[1]
  ?? (expected === 'doctorQuery' && /^dr\.?\s+.+$/i.test(answer) ? answer : undefined);
 if (doctor && /^[\p{L}][\p{L} .’'-]{1,119}$/u.test(doctor)) next.doctorQuery = doctor;
 const plan = answer.match(/^my (?:health )?plan(?: name)? is (.{2,120})$/i)?.[1];
 if (plan) next.planQuery = plan;

 if (expected === 'employerPremium' || expected === 'marketplacePremium') {
  const premium = answer.match(/^(.*?)(?:\s+(?:(?:per\s+)?(month|week)|(?:every two weeks|biweekly|twice a month)))?$/i);
  const value = premium && money(premium[1]);
  const frequency = answer.match(/\b(biweekly|every two weeks|twice a month|week|month)$/i)?.[1].toLowerCase();
  if (value && expected === 'employerPremium') {
   const periods = { month: 'monthly', week: 'weekly', biweekly: 'biweekly', 'every two weeks': 'biweekly', 'twice a month': 'semimonthly' } as const;
   if (frequency && frequency in periods) {
    const period = periods[frequency as keyof typeof periods];
    if (previous.comparison !== 'medicaid' || period === 'monthly') {
     next.employerPremium = value;
     next.employerFrequency = period;
    }
   }
  }
  if (value && expected === 'marketplacePremium' && (!frequency || frequency === 'month')) next.marketplacePremium = value;
 }
 if (expected === 'premiumBasis') {
  if (/^(?:just me|only me|me only|both (?:are )?just for me)$/i.test(answer)) next.premiumBasis = 'self';
  if (/^(?:the )?same (?:people|household members)$/i.test(answer)) next.premiumBasis = 'household';
 }

 return (Object.keys(next) as Array<keyof GuruContext>).some(key => next[key] !== previous[key])
  ? reconcileContext(previous, next)
  : previous;
}
