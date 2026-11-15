import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validReadinessProof } from '@/lib/guru/readiness';
import { visitorIdentity } from '@/lib/guru/visitor';
import { publicCaps } from '@/lib/guru/budget';
import { MODEL_IDS, PRICING_DATE } from '@/lib/guru/planner';
export const runtime='nodejs';
export const dynamic='force-dynamic';
/** Authenticated operational readback. No raw IP, cookie, credential or user records. */
export async function POST(req:Request) {
 const headers={'Cache-Control':'no-store'};
 if(!validReadinessProof(req.headers.get('x-affinity-release-proof'),process.env.AFFINITY_GURU_VISITOR_SECRET))return new NextResponse(null,{status:404,headers});
 try {
  const {identity}=visitorIdentity(req,process.env.AFFINITY_GURU_VISITOR_SECRET,process.env.AFFINITY_GURU_CLIENT_IP_HEADER);
  const caps=publicCaps(process.env);
  const rows=await prisma.$queryRaw<Array<{bytes:bigint}>>`SELECT pg_database_size(current_database()) AS bytes`;
  await prisma.$queryRaw`SELECT id,"reservedMicro","visitorHash","networkHash" FROM "GuruReservation" LIMIT 0`;
  return NextResponse.json({revision:process.env.RENDER_GIT_COMMIT??null,enabled:process.env.AFFINITY_GURU_ENABLED==='1',keyConfigured:!!process.env.AFFINITY_OPENAI_API_KEY,model:MODEL_IDS.includes(process.env.AFFINITY_GURU_MODEL as typeof MODEL_IDS[number])?process.env.AFFINITY_GURU_MODEL:null,pricingDate:PRICING_DATE,caps,ledgerReady:true,databaseBytes:Number(rows[0].bytes),networkFingerprint:identity.networkHash},{headers});
 } catch { return NextResponse.json({ready:false},{status:503,headers}); }
}
