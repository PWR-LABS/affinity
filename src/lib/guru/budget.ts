import type { PrismaClient } from '@prisma/client';
import { RESERVATION_MICRO, TERRA_RESERVATION_MICRO, type ReservationMicro } from './planner';
import { PUBLIC_MONTHLY_USD, PUBLIC_DAILY_USD, VISITOR_LIMITS, NETWORK_LIMITS, TEST_BROWSER_LIMITS } from './allowance';
import type { GuruIdentity } from './visitor';
import type { AttemptUsage } from './usage';

export function capMicro(value:string|undefined){
 if(!value||!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('A positive owner-configured cap is required');
 const amount=Math.round(Number(value)*1e6);
 if(!Number.isSafeInteger(amount)||amount<RESERVATION_MICRO||amount>100e6)throw Error('Invalid guru cap');
 return amount;
}
export function publicCaps(env: Record<string, string | undefined>) {
 const monthly = capMicro(env.AFFINITY_GURU_MONTHLY_USD ?? PUBLIC_MONTHLY_USD);
 const daily = capMicro(env.AFFINITY_GURU_DAILY_USD ?? PUBLIC_DAILY_USD);
 if (daily > Number(PUBLIC_DAILY_USD) * 1e6 || daily > monthly) throw Error('Invalid public daily cap');
 return { monthly, daily };
}
export class GuruLimitError extends Error {
 constructor(readonly scope: 'site' | 'visitor' | 'network', readonly window: 'minute' | 'day' | 'month', readonly retryAfter: number) {
  super('Guru allowance exhausted');
 }
}
/** All checks and insertion share one durable lock across workers and restarts. */
export async function reserveTurn(db:PrismaClient,id:string,monthly:number,daily:number,identity:GuruIdentity,reservedMicro:ReservationMicro=RESERVATION_MICRO,testBrowser=false){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Invalid request identity');
 id=id.toLowerCase();
 if(reservedMicro!==RESERVATION_MICRO&&reservedMicro!==TERRA_RESERVATION_MICRO)throw Error('Invalid guru reservation');
 if(![monthly,daily].every(n=>Number.isSafeInteger(n)&&n>=reservedMicro&&n<=100e6))throw Error('Invalid guru cap');
 if(!identity||![identity.visitorHash,identity.networkHash].every(x=>/^[0-9a-f]{64}$/.test(x)))throw Error('Visitor identity required');
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(184937023)`;
  const existing=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "GuruReservation" WHERE id=${id}`;
  if(existing.length)throw Error('Request already reserved');
  const [{ now }] = await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const minute = new Date(now.getTime() - 60000);
  // Keep accounting/duplicate protection; remove old identifying hashes.
  await tx.$executeRaw`UPDATE "GuruReservation" SET "visitorHash"=NULL,"networkHash"=NULL WHERE "createdAt"<LEAST(${month},${minute}) AND ("visitorHash" IS NOT NULL OR "networkHash" IS NOT NULL)`;
  const [totals]=await tx.$queryRaw<Array<{month:bigint;day:bigint}>>`SELECT COALESCE(sum("reservedMicro"),0) AS month, COALESCE(sum("reservedMicro") FILTER (WHERE "createdAt">=${day}),0) AS day FROM "GuruReservation" WHERE "createdAt">=${month}`;
  const retry = (window:'minute'|'day'|'month') => window === 'minute' ? 60 : Math.max(1, Math.ceil(((window === 'day' ? day.getTime()+86400000 : Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)) - now.getTime()) / 1000));
  if(Number(totals.month)+reservedMicro>monthly)throw new GuruLimitError('site','month',retry('month'));
  if(Number(totals.day)+reservedMicro>daily)throw new GuruLimitError('site','day',retry('day'));
  const counts=await tx.$queryRaw<Array<{scope:string;month:bigint;day:bigint;minute:bigint}>>`
   SELECT 'visitor' AS scope,count(*) FILTER (WHERE "createdAt">=${month}) AS month,count(*) FILTER (WHERE "createdAt">=${day}) AS day,count(*) FILTER (WHERE "createdAt">=${minute}) AS minute
   FROM "GuruReservation" WHERE "visitorHash"=${identity.visitorHash} AND "createdAt">=LEAST(${month},${minute})
   UNION ALL
   SELECT 'network' AS scope,count(*) FILTER (WHERE "createdAt">=${month}) AS month,count(*) FILTER (WHERE "createdAt">=${day}) AS day,count(*) FILTER (WHERE "createdAt">=${minute}) AS minute
   FROM "GuruReservation" WHERE "networkHash"=${identity.networkHash} AND "createdAt">=LEAST(${month},${minute})`;
  for(const row of counts){
   const scope=row.scope as 'visitor'|'network';
   const limits=testBrowser?TEST_BROWSER_LIMITS:scope==='visitor'?VISITOR_LIMITS:NETWORK_LIMITS;
   for(const window of ['month','day','minute'] as const)if(Number(row[window])>=limits[window])throw new GuruLimitError(scope,window,retry(window));
  }
  await tx.$executeRaw`INSERT INTO "GuruReservation" (id,"reservedMicro","createdAt","visitorHash","networkHash") VALUES (${id},${reservedMicro},${now},${identity.visitorHash},${identity.networkHash})`;
 },{timeout:5000,maxWait:2000});
}

export async function recordTurnUsage(db: PrismaClient, id: string, usage: AttemptUsage): Promise<void> {
 const result = await db.guruReservation.updateMany({
  where: { id: id.toLowerCase(), usageModel: null },
  data: {
   usageModel: usage.model,
   usageInputTokens: usage.inputTokens,
   usageCachedInputTokens: usage.cachedInputTokens,
   usageCacheWriteInputTokens: usage.cacheWriteInputTokens,
   usageOutputTokens: usage.outputTokens,
   usageReasoningTokens: usage.reasoningTokens,
   usageEstimatedCostPicoUsd: usage.estimatedCostPicoUsd,
  },
 });
 if (result.count !== 1) throw Error('Guru usage receipt could not be recorded');
}
