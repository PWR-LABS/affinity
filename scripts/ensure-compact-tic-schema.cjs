/** Additive, idempotent runtime migration. No data rewrite or cloud provisioning. */
const {PrismaClient}=require('@prisma/client');
function allowed(env){
 if(!env.DATABASE_URL)return false;
 const u=new URL(env.DATABASE_URL);
 if(env.AFFINITY_COMPACT_SCHEMA_LOCAL==='1'){
  if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/affinity_employer_e2e'||u.port!=='55439')throw new Error('Local schema target rejected');
  return true;
 }
 if(env.RENDER!=='true')return false;
 if(env.RENDER_SERVICE_ID!=='srv-d9227o9kh4rs73c4i1tg'||env.RENDER_GIT_BRANCH!=='main'||u.pathname!=='/affinity_db_grhk'||!['dpg-d93fiqpkh4rs73d75cjg-a','dpg-d93fiqpkh4rs73d75cjg-a.ohio-postgres.render.com'].includes(u.hostname))throw new Error('Production schema target rejected');
 return true;
}
async function ensure(db){
 await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='210s'");
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(184937022)');
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TicNpiIndex" (
   "fileId" text PRIMARY KEY REFERENCES "TicFile"(id) ON DELETE CASCADE ON UPDATE CASCADE,
   format text NOT NULL CHECK(format='npi-prefix-v1'),
   "sourceMembershipCount" integer NOT NULL CHECK("sourceMembershipCount" BETWEEN 1 AND 5000000),
   "membershipSha256" text NOT NULL CHECK("membershipSha256" ~ '^[a-f0-9]{64}$'),
   "npiCount" integer NOT NULL CHECK("npiCount" BETWEEN 1 AND 5000000),
   "npiSha256" text NOT NULL CHECK("npiSha256" ~ '^[a-f0-9]{64}$'),
   "bucketCount" integer NOT NULL CHECK("bucketCount" BETWEEN 1 AND 10000),
   "encodedBytes" integer NOT NULL CHECK("encodedBytes" BETWEEN 1 AND 32000000),
   "manifestSha256" text NOT NULL CHECK("manifestSha256" ~ '^[a-f0-9]{64}$'))`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TicNpiBucket" (
   "fileId" text NOT NULL REFERENCES "TicNpiIndex"("fileId") ON DELETE CASCADE ON UPDATE CASCADE,
   prefix text NOT NULL CHECK(prefix ~ '^[0-9]{4}$'),
   count integer NOT NULL CHECK(count BETWEEN 1 AND 1000000),
   "rawSha256" text NOT NULL CHECK("rawSha256" ~ '^[a-f0-9]{64}$'),
   "payloadSha256" text NOT NULL CHECK("payloadSha256" ~ '^[a-f0-9]{64}$'),
   payload bytea NOT NULL CHECK(octet_length(payload) BETWEEN 1 AND 4100000),
   PRIMARY KEY("fileId",prefix))`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TicPlanSet" (
 id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'),
 count integer NOT NULL CHECK(count BETWEEN 1 AND 30000)
)`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TicPlanSetEntry" (
 "setId" text NOT NULL REFERENCES "TicPlanSet"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 29999),
 "planName" text NOT NULL,
 "planIdType" text NOT NULL CHECK("planIdType" IN ('ein','hios')),
 "planId" text NOT NULL CHECK(length("planId") > 0),
 "planMarketType" text NOT NULL,
 PRIMARY KEY("setId",ordinal)
)`);
  await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TicPlanSetEntry_planIdType_planId_idx" ON "TicPlanSetEntry"("planIdType","planId")`);
  await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "TicFilePlanSet" (
 "fileId" text PRIMARY KEY REFERENCES "TicFile"(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "setId" text NOT NULL REFERENCES "TicPlanSet"(id) ON DELETE RESTRICT ON UPDATE CASCADE
)`);
  await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "TicFilePlanSet_setId_idx" ON "TicFilePlanSet"("setId")`);
  await tx.$executeRawUnsafe(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='affinity_refresh') THEN GRANT SELECT,INSERT,DELETE ON "TicNpiIndex","TicNpiBucket","TicPlanSet","TicPlanSetEntry","TicFilePlanSet" TO affinity_refresh; END IF; END $$`);
 },{timeout:240000,maxWait:10000});
}
module.exports={allowed,ensure};
if(require.main===module)(async()=>{
 if(!allowed(process.env))return;
 const db=new PrismaClient({log:[]});try{await ensure(db);console.log('Compact TiC schema verified; existing data preserved.');}finally{await db.$disconnect();}
})().catch(()=>{console.error('Compact TiC schema readiness failed; refusing new web startup.');process.exitCode=1;});
