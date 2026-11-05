import {firstFilePlan} from '../../src/lib/tic/shared-plans';
import {decodeBucket} from '../../src/lib/tic/compact-codec';
import type { PrismaClient } from '@prisma/client';
/** Public issuer data only. A missing provider must remain unknown, never an inferred no. */
export async function verifyServing(db:PrismaClient,fileId:string,fetcher=fetch){
 let member:{npi:string}|null=await db.ticMembership.findFirst({where:{fileId}});
 if(!member){const bucket=await db.ticNpiBucket.findFirstOrThrow({where:{fileId},orderBy:{prefix:'asc'}});const raw=decodeBucket(bucket);member={npi:bucket.prefix+String(raw.readUInt32LE(0)).padStart(6,'0')};}
 if(!member)throw new Error('Missing serving evidence');
 const link=await firstFilePlan(db,fileId);
 for(const npi of [member.npi,'0000000000']){
  const response=await fetcher('https://affinity.pwr-labs.ai/api/tic/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({npi,planIdType:link.planIdType,planId:link.planId}),signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error('public_serving_readback_failed');
  const answer=await response.json();
  if(answer.value!==(npi===member.npi?'yes':'unknown')||(npi===member.npi&&answer.evidenceStatus!=='listed'))throw new Error('public_serving_readback_mismatch');
 }
}
