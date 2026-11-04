/** Owner URL is a temporary protected input; never log it. This creates a narrowly scoped publisher role. */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, stateRoot } from './lib/refresh-runtime';
async function main() {
  const owner = new URL(await readFile('/tmp/affinity-refresh-owner-url','utf8'));
  if (owner.hostname !== 'dpg-d93fiqpkh4rs73d75cjg-a.ohio-postgres.render.com' || owner.pathname !== '/affinity_db_grhk' || owner.searchParams.get('sslmode') !== 'require') throw new Error('Wrong database');
  const db = new PrismaClient({ datasourceUrl: owner.toString(), log: [] });
  try {
    await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "TicRefreshPublication" ("id" text PRIMARY KEY, "stableKey" text NOT NULL, "fileId" text NOT NULL UNIQUE REFERENCES "TicFile"(id) ON DELETE CASCADE, "sourceDate" text NOT NULL, "contentHash" text NOT NULL, "receiptPath" text NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now())');
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "TicRefreshPublication_stableKey" ON "TicRefreshPublication" ("stableKey", "sourceDate")');
    const existing = await db.$queryRawUnsafe<Array<{rolname:string}>>("SELECT rolname FROM pg_roles WHERE rolname = 'affinity_refresh'");
    if (existing.length) throw new Error('Publisher role already exists; preserve credential instead of rotating blindly');
    const password = randomBytes(32).toString('hex');
    await db.$executeRawUnsafe(`CREATE ROLE affinity_refresh LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2`);
    await db.$executeRawUnsafe('GRANT CONNECT ON DATABASE affinity_db_grhk TO affinity_refresh');
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO affinity_refresh');
    await db.$executeRawUnsafe('GRANT SELECT, INSERT, DELETE ON "TicFile", "TicMembership", "TicPlanLink", "TicRefreshPublication" TO affinity_refresh');
    await mkdir(stateRoot,{recursive:true,mode:0o700}); await chmod(stateRoot,0o700);
    owner.username = 'affinity_refresh'; owner.password = password;
    await atomicJson(join(stateRoot,'database.json'), { url: owner.toString() });
    console.log('Scoped publisher credential installed; tables limited to TiC refresh.');
  } finally { await db.$disconnect(); await unlink('/tmp/affinity-refresh-owner-url'); }
}
main().catch(()=>{ console.error('Credential setup failed; protected input removed. No credential details emitted.'); process.exitCode=1; });
