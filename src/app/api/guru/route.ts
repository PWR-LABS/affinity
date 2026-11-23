import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { contextSchema,ACTIONS } from '@/lib/guru/workspace';
import { MODEL_IDS } from '@/lib/guru/planner';
import { assertPublicPricing } from '@/lib/guru/pricing';
import { historySchema } from '@/lib/guru/chat';
import { conversationTurn } from '@/lib/guru/conversation';
import { currentEvidence } from '@/lib/guru/tools';
import { publicCaps, recordTurnUsage, reserveTurn, GuruLimitError } from '@/lib/guru/budget';

import { visitorIdentity } from '@/lib/guru/visitor';
import { allowanceMessage } from '@/lib/guru/allowance';
import { guruOriginAllowed } from '@/lib/guru/origin';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const input=z.object({id:z.string().uuid(),history:historySchema.min(1),context:contextSchema,evidenceActions:z.array(z.enum(ACTIONS)).max(3)}).strict();
const unavailable=()=>NextResponse.json({mode:'guided',error:'Connected AI is unavailable. Your guided workspace and coverage tools still work.'},{status:503,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){
 // Explicit deployment configuration is separate from implementing the feature.
 if(process.env.AFFINITY_GURU_ENABLED!=='1'||!process.env.AFFINITY_OPENAI_API_KEY)return unavailable();
 if(!guruOriginAllowed(req,process.env))return NextResponse.json({error:'Use guru from this site.'},{status:403});
 let cookie:string|undefined;
 const withCookie=(response:NextResponse)=>{if(cookie)response.headers.set('Set-Cookie',cookie);return response;};
 try{
  const {monthly,daily}=publicCaps(process.env);
  const visitor=visitorIdentity(req,process.env.AFFINITY_GURU_VISITOR_SECRET,process.env.AFFINITY_GURU_CLIENT_IP_HEADER);
  cookie=visitor.cookie;
  const model=z.enum(MODEL_IDS).parse(process.env.AFFINITY_GURU_MODEL);
  const reader=req.body?.getReader();if(!reader)return unavailable();
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16000){await reader.cancel();return NextResponse.json({error:'Please shorten this question.'},{status:413});}chunks.push(value);}
  const body=input.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  // History is not source authority. Re-read applicable evidence through the
  // actual allowlisted tools; never accept client- or model-supplied coverage.
  const evidence=await currentEvidence(body.evidenceActions,body.context);
  const reply=await conversationTurn({
   model,history:body.history,context:body.context,evidence,key:process.env.AFFINITY_OPENAI_API_KEY,
   checkPricing:assertPublicPricing,
   reserve:()=>reserveTurn(prisma,body.id,monthly,daily,visitor.identity),
   recordUsage:(usage)=>recordTurnUsage(prisma,body.id,usage),
  });
  return withCookie(NextResponse.json({mode:'connected',reply,evidence},{headers:{'Cache-Control':'no-store'}}));
 }catch(error){
  if(error instanceof GuruLimitError)return withCookie(NextResponse.json({mode:'guided',code:'guru_limit',scope:error.scope,window:error.window,error:allowanceMessage(error.scope,error.window)},{status:429,headers:{'Cache-Control':'no-store','Retry-After':String(error.retryAfter)}}));
  // No request body, raw upstream error, credentials or identifiers in logs.
  return withCookie(unavailable());
 }
}
