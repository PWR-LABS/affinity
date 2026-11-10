import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { contextSchema } from '@/lib/guru/workspace';
import { MODEL_IDS, planTurn } from '@/lib/guru/planner';
import { capMicro, reserveTurn } from '@/lib/guru/budget';

export const dynamic='force-dynamic';
const input=z.object({id:z.string().uuid(),message:z.string().trim().min(1).max(1500),context:contextSchema}).strict();
const unavailable=()=>NextResponse.json({mode:'guided',error:'Connected AI is unavailable. Your guided workspace and coverage tools still work.'},{status:503,headers:{'Cache-Control':'no-store'}});
export async function POST(req:Request){
 // Explicit deployment configuration is separate from implementing the feature.
 if(process.env.AFFINITY_GURU_ENABLED!=='1'||!process.env.AFFINITY_OPENAI_API_KEY)return unavailable();
 const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)return NextResponse.json({error:'Use guru from this site.'},{status:403});
 try{
  const monthly=capMicro(process.env.AFFINITY_GURU_MONTHLY_USD),daily=capMicro(process.env.AFFINITY_GURU_DAILY_USD);
  const model=z.enum(MODEL_IDS).parse(process.env.AFFINITY_GURU_MODEL);
  const reader=req.body?.getReader();if(!reader)return unavailable();
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8000){await reader.cancel();return NextResponse.json({error:'Please shorten this question.'},{status:413});}chunks.push(value);}
  const body=input.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  const proposal=await planTurn({model,message:body.message,context:body.context,key:process.env.AFFINITY_OPENAI_API_KEY,reserve:()=>reserveTurn(prisma,body.id,monthly,daily)});
  return NextResponse.json({mode:'connected',proposal},{headers:{'Cache-Control':'no-store'}});
 }catch{
  // No request body, raw upstream error, credentials or identifiers in logs.
  return unavailable();
 }
}
