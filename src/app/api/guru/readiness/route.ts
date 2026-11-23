import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validReadinessProof } from '@/lib/guru/readiness';
import { visitorIdentity } from '@/lib/guru/visitor';
import { publicCaps } from '@/lib/guru/budget';
import { MODEL_IDS, PRICING_DATE, publicPricingStatus } from '@/lib/guru/pricing';
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
  const enabled=process.env.AFFINITY_GURU_ENABLED==='1';
  const model=MODEL_IDS.find(id=>id===process.env.AFFINITY_GURU_MODEL)??null;
  const pricing=enabled&&model?await publicPricingStatus(model):null;
  return NextResponse.json({revision:process.env.RENDER_GIT_COMMIT??null,enabled,keyConfigured:!!process.env.AFFINITY_OPENAI_API_KEY,model,pricingDate:PRICING_DATE,pricing,caps,ledgerReady:true,databaseBytes:Number(rows[0].bytes),networkFingerprint:identity.networkHash},{headers});
 } catch { return NextResponse.json({ready:false},{status:503,headers}); }
}
