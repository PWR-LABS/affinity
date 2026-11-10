import type { PrismaClient } from '@prisma/client';
import { RESERVATION_MICRO } from './planner';

export function capMicro(value:string|undefined){
 if(!value||!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('A positive owner-configured cap is required');
 const amount=Math.round(Number(value)*1e6);
 if(!Number.isSafeInteger(amount)||amount<RESERVATION_MICRO||amount>100e6)throw Error('Invalid guru cap');
 return amount;
}
/** Shared durable ledger, no conversation, household values or IP address. */
export async function reserveTurn(db:PrismaClient,id:string,monthly:number,daily:number){
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid request identity');
  if(![monthly,daily].every(n=>Number.isSafeInteger(n)&&n>=RESERVATION_MICRO&&n<=100e6))throw Error('Invalid guru cap');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(184937023)`;
  const existing=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "GuruReservation" WHERE id=${id}`;
  if(existing.length)throw Error('Request already reserved');
  const totals=await tx.$queryRaw<Array<{month:bigint;day:bigint}>>`SELECT COALESCE(sum("reservedMicro"),0) AS month, COALESCE(sum("reservedMicro") FILTER (WHERE "createdAt">=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0) AS day FROM "GuruReservation" WHERE "createdAt">=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
  if(Number(totals[0].month)+RESERVATION_MICRO>monthly||Number(totals[0].day)+RESERVATION_MICRO>daily)throw Error('Guru allowance exhausted');
  await tx.$executeRaw`INSERT INTO "GuruReservation" (id,"reservedMicro","createdAt") VALUES (${id},${RESERVATION_MICRO},now())`;
 },{timeout:5000,maxWait:2000});
}
