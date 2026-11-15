/** Additive guru ledger migration on the existing, exact Render database only. */
const { PrismaClient } = require('@prisma/client');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const migrations = ['20261110000000_guru_budget', '20261112000000_guru_fair_use'];
function allowed(env) {
 if (!env.DATABASE_URL || env.RENDER !== 'true') return false;
 const u = new URL(env.DATABASE_URL);
 if (env.RENDER_SERVICE_ID !== 'srv-d9227o9kh4rs73c4i1tg' || env.RENDER_GIT_BRANCH !== 'main' || u.pathname !== '/affinity_db_grhk' || !['dpg-d93fiqpkh4rs73d75cjg-a','dpg-d93fiqpkh4rs73d75cjg-a.ohio-postgres.render.com'].includes(u.hostname)) throw Error('Guru schema target rejected');
 return true;
}
async function ensure(db) {
 await db.$transaction(async tx => {
  await tx.$executeRawUnsafe("SET LOCAL lock_timeout='10s'");
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(184937023)');
  const [size] = await tx.$queryRawUnsafe('SELECT pg_database_size(current_database()) AS bytes');
  if (Number(size.bytes) >= 2500000000) throw Error('Existing database budget exceeded');
  // The same checked-in additive DDL, made idempotent for the established startup path.
  for (const name of migrations) {
   const sql = readFileSync(join(__dirname,'..','prisma','migrations',name,'migration.sql'),'utf8')
    .replace(/^--.*$/gm,'')
    .replace(/CREATE TABLE /g,'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE INDEX /g,'CREATE INDEX IF NOT EXISTS ')
    .replace(/ADD COLUMN /g,'ADD COLUMN IF NOT EXISTS ');
   for (const statement of sql.split(';').map(x=>x.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
  }
  await tx.$queryRawUnsafe('SELECT id,"reservedMicro","createdAt","visitorHash","networkHash" FROM "GuruReservation" LIMIT 0');
 }, {timeout:30000,maxWait:5000});
}
module.exports = { allowed, ensure };
if(require.main===module)(async()=>{
 if(!allowed(process.env)) return;
 const db=new PrismaClient({log:[]});
 try { await ensure(db); console.log('Guru reservation schema verified within existing database budget.'); }
 finally { await db.$disconnect(); }
})().catch(()=>{console.error('Guru schema readiness failed; refusing new web startup.');process.exitCode=1;});
