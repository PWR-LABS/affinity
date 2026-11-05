import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {ticSourceWindow} from './freshness';
export const SHARED_PLAN_FORMAT='shared-plan-set-v1';
const domain=Buffer.from(SHARED_PLAN_FORMAT+'\n');
export type PlanRecord={planName:string;planIdType:string;planId:string;planMarketType:string};
type Db=Pick<Prisma.TransactionClient,'ticPlanSet'|'ticPlanSetEntry'|'ticFilePlanSet'|'ticPlanLink'|'$queryRaw'>;
function encoded(plan:PlanRecord){return Buffer.concat([plan.planName,plan.planIdType,plan.planId,plan.planMarketType].flatMap(value=>{const bytes=Buffer.from(value);if(value.includes('\0')||bytes.toString('utf8')!==value)throw new Error('Plan metadata is not lossless PostgreSQL UTF-8 text');const length=Buffer.alloc(4);length.writeInt32BE(bytes.length);return [length,bytes];}));}
/** Length-prefixed UTF-8 fields, binary order and a domain separator avoid JSON,
 * locale and concatenation ambiguities. Every original field is retained. */
export function planSet(plans:PlanRecord[]){
 if(!plans.length||plans.length>30000)throw new Error('Invalid plan-set count');
 const ordered=plans.map(plan=>{if(!['ein','hios'].includes(plan.planIdType)||!plan.planId||Object.values(plan).some(v=>typeof v!=='string'))throw new Error('Invalid plan metadata');return {plan,bytes:encoded(plan)};}).sort((a,b)=>Buffer.compare(a.bytes,b.bytes));
 const hash=createHash('sha256').update(domain);
 for(let i=0;i<ordered.length;i++){if(i&&ordered[i].bytes.equals(ordered[i-1].bytes))throw new Error('Duplicate plan metadata');hash.update(createHash('sha256').update(ordered[i].bytes).digest());}
 return {id:hash.digest('hex'),count:ordered.length,metadataBytes:ordered.reduce((n,x)=>n+x.bytes.length,0),plans:ordered.map(x=>x.plan)};
}
/** Hash actual stored fields inside Postgres; no repeated metadata egress. */
export async function verifyPlanSet(db:Db,id:string,expectedCount?:number){
 const set=await db.ticPlanSet.findUnique({where:{id}});if(!set)return false;
 const rows=await db.$queryRaw<Array<{count:bigint;first:number|null;last:number|null;digest:string|null}>>`
 SELECT count(*) AS count,min(ordinal) AS first,max(ordinal) AS last,
 encode(sha256(${domain}::bytea || string_agg(sha256(
 int4send(octet_length(convert_to("planName",'UTF8'))) || convert_to("planName",'UTF8') ||
 int4send(octet_length(convert_to("planIdType",'UTF8'))) || convert_to("planIdType",'UTF8') ||
 int4send(octet_length(convert_to("planId",'UTF8'))) || convert_to("planId",'UTF8') ||
 int4send(octet_length(convert_to("planMarketType",'UTF8'))) || convert_to("planMarketType",'UTF8')
 ),''::bytea ORDER BY ordinal)),'hex') AS digest FROM "TicPlanSetEntry" WHERE "setId"=${id}`;
 const row=rows[0];if(!row||Number(row.count)!==set.count||row.first!==0||row.last!==set.count-1||row.digest!==id||(expectedCount!==undefined&&set.count!==expectedCount))throw new Error('Shared plan-set readback mismatch');return true;
}
export async function planReservationCount(db:Db,plans:PlanRecord[],shared:boolean){
 if(!shared)return plans.length;const set=planSet(plans);return await verifyPlanSet(db,set.id,set.count)?1:Math.max(plans.length,Math.ceil(set.metadataBytes*3/2000));
}
export async function storeSharedPlans(db:Db,fileId:string,plans:PlanRecord[],guard:()=>void){
 const set=planSet(plans);
 if(!await verifyPlanSet(db,set.id,set.count)){
  await db.ticPlanSet.create({data:{id:set.id,count:set.count}});
  for(let i=0;i<set.count;i+=1000){guard();await db.ticPlanSetEntry.createMany({data:set.plans.slice(i,i+1000).map((plan,j)=>({...plan,setId:set.id,ordinal:i+j}))});}
  if(!await verifyPlanSet(db,set.id,set.count))throw new Error('Shared plan-set missing');
 }
 await db.ticFilePlanSet.create({data:{fileId,setId:set.id}});
}
export async function filePlanCount(db:Db,fileId:string,expected?:PlanRecord[]){
 const link=await db.ticFilePlanSet.findUnique({where:{fileId}}),legacy=await db.ticPlanLink.count({where:{fileId}});
 if(!link)return legacy;if(legacy)throw new Error('Mixed file plan representations');
 const wanted=expected?planSet(expected):undefined;if(wanted&&wanted.id!==link.setId)throw new Error('File plan-set identity mismatch');
 if(!await verifyPlanSet(db,link.setId,wanted?.count))throw new Error('File plan-set unavailable');
 return (await db.ticPlanSet.findUniqueOrThrow({where:{id:link.setId}})).count;
}
export async function firstFilePlan(db:Db,fileId:string){
 const legacy=await db.ticPlanLink.findFirst({where:{fileId}});if(legacy)return legacy;
 const link=await db.ticFilePlanSet.findUniqueOrThrow({where:{fileId}});return db.ticPlanSetEntry.findFirstOrThrow({where:{setId:link.setId},orderBy:{ordinal:'asc'}});
}
export async function fileLinksForPlan(db:Db,planIdType:string,planId:string){
 const select={fileId:true,file:{select:{url:true,sourceLastUpdated:true}}} as const;
 const legacy=await db.ticPlanLink.findMany({where:{planIdType,planId,file:{active:true}},select});
 const shared=await db.ticFilePlanSet.findMany({where:{file:{active:true},set:{entries:{some:{planIdType,planId}}}},select});
 return [...new Map([...legacy,...shared].map(link=>[link.fileId,link])).values()];
}
export async function searchTicPlans(db:Db,q:string,now=new Date()){
 const file={active:true,sourceLastUpdated:ticSourceWindow(now),OR:[{memberships:{some:{}}},{compactIndex:{is:{format:'npi-prefix-v1',npiCount:{gt:0}}}}]} satisfies Prisma.TicFileWhereInput;
 const fields={planName:true,planIdType:true,planId:true,planMarketType:true} as const;
 const legacy=await db.ticPlanLink.findMany({where:{planName:{contains:q,mode:'insensitive'},file},distinct:['planIdType','planId','planName'],take:12,select:{...fields,file:{select:{reportingEntity:true}}},orderBy:{planName:'asc'}});
 const shared=await db.ticPlanSetEntry.findMany({where:{planName:{contains:q,mode:'insensitive'},set:{files:{some:{file}}}},distinct:['planIdType','planId','planName'],take:12,select:{...fields,set:{select:{files:{where:{file},take:1,orderBy:{fileId:'asc'},select:{file:{select:{reportingEntity:true}}}}}}},orderBy:{planName:'asc'}});
 const rows=[...legacy,...shared.filter(x=>x.set.files.length).map(x=>({...x,file:x.set.files[0].file}))];
 return [...new Map(rows.map(row=>[JSON.stringify([row.planIdType,row.planId,row.planName]),row])).values()].sort((a,b)=>a.planName.localeCompare(b.planName)).slice(0,12).map(row=>({planIdType:row.planIdType,planId:row.planId,planName:row.planName,marketType:row.planMarketType,issuer:row.file.reportingEntity}));
}
