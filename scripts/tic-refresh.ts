/** Prepare first; publish only with an explicit database host guard. Never prints credentials. */
import { readFile, writeFile, mkdir, stat, open } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { httpsUrl, member, receiptSchema, sha256, tocPlans, rows, type TicPublication, publishPublication, validatePublication } from '../src/lib/tic/publication';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runExtract } from '../tools/tic-ingest/tic-extract';
export async function preparePublication(args: { sourcePath: string; sourceUrl: string; tocPath: string; tocUrl: string; directory: string; guard?: () => void }): Promise<TicPublication> {
  httpsUrl.parse(args.sourceUrl); httpsUrl.parse(args.tocUrl);
  const sourcePath = resolve(args.sourcePath), tocPath = resolve(args.tocPath);
  if ((await stat(sourcePath)).size > 150_000_000) throw new Error('Source exceeds bounded 150 MB refresh limit');
  const source = await open(sourcePath, 'r');
  const prefix = Buffer.alloc(1024);
  let read = 0;
  try { read = (await source.read(prefix,0,prefix.length,0)).bytesRead; } finally { await source.close(); }
  if (prefix[0] === 0x50 && prefix[1] === 0x4b) throw new Error('Source container requires ZIP adapter');
  if (!(prefix[0] === 0x1f && prefix[1] === 0x8b) && !prefix.subarray(0,read).toString().trimStart().startsWith('{')) throw new Error('Source is not JSON/gzip rate data');
  const sourceSha256 = await sha256(sourcePath), tocSha256 = await sha256(tocPath);
  const plans = await tocPlans(tocPath, args.sourceUrl);
  args.guard?.();
  await mkdir(args.directory, { recursive: true });
  const membershipPath = resolve(args.directory, `${sourceSha256}.ndjson`);
  const summary = await runExtract({ input: sourcePath, sourceUrl: args.sourceUrl, out: membershipPath, progress: false, maxPairs: 200_000, strictReferences: true, maxMs: 600_000, guard: args.guard });
  if (summary.remote_refs_404 || summary.remote_refs_fetched) throw new Error('Remote references require a separately archived, verified refresh');
  let first: z.infer<typeof member> | undefined;
  let count = 0;
  for await (const row of rows(membershipPath)) {
    first ??= row;
    if (row.file_url !== args.sourceUrl || row.last_updated_on !== first.last_updated_on || row.reporting_entity !== first.reporting_entity || row.schema !== first.schema) throw new Error('Mixed source metadata');
    if (++count > 200_000) throw new Error('Membership limit exceeded');
  }
  if (!first || count !== summary.pairs_emitted) throw new Error('Empty or incomplete extraction');
  const receipt = receiptSchema.parse({ ...args, version: 1, scope: 'selected-file-only; plan completeness unverified', sourcePath, sourceSha256, tocPath, tocSha256, membershipPath,
    membershipSha256: await sha256(membershipPath), membershipCount: count, sourceDate: first.last_updated_on, reportingEntity: first.reporting_entity, schema: first.schema, plans, preparedAt: new Date().toISOString() });
  await validatePublication(receipt);
  args.guard?.();
  await writeFile(resolve(args.directory, 'publication.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
function arg(key: string) { const i = process.argv.indexOf(`--${key}`); return i < 0 ? undefined : process.argv[i + 1]; }
function required(key: string) { const value = arg(key); if (!value) throw new Error(`Missing --${key}`); return value; }
async function main() {
  const action = required('action');
  if (action === 'prepare') {
    const r = await preparePublication({ sourcePath: required('source'), sourceUrl: required('source-url'), tocPath: required('toc'), tocUrl: required('toc-url'), directory: required('out') });
    console.log(JSON.stringify({ sourceDate: r.sourceDate, memberships: r.membershipCount, plans: r.plans.length, scope: r.scope }));
    return;
  }
  const r = JSON.parse(await readFile(required('receipt'), 'utf8'));
  if (action === 'validate') { await validatePublication(r); console.log('Validated'); return; }
  if (action !== 'publish') throw new Error('Unknown action');
  const u = new URL(process.env.DATABASE_URL ?? '');
  if (u.hostname !== required('expected-host')) throw new Error('Database host guard mismatch');
  if (!['localhost','127.0.0.1'].includes(u.hostname) && u.searchParams.get('sslmode') !== 'require') throw new Error('External publication requires TLS');
  const output = required('result');
  const db = new PrismaClient();
  try { const result = await publishPublication(db, r); await writeFile(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result)); }
  finally { await db.$disconnect(); }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch(error => { console.error(error instanceof Error && !('code' in error) ? error.message : 'Publication failed; inspect protected local diagnostics.'); process.exitCode = 1; });
