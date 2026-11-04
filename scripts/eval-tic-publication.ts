/** Real Postgres rollback test; refuses any database except the disposable loopback fixture. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { publishPublication, validatePublication, sha256 } from '../src/lib/tic/publication';
import { queryTicAnswer } from '../src/lib/tic/adapter';
const u = new URL(process.env.DATABASE_URL ?? '');
assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.pathname, '/affinity_employer_e2e');
const db = new PrismaClient();
const passed: string[] = [];
async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'affinity-publication-test-'));
  try {
    await db.ticFile.deleteMany();
    const old = await db.ticFile.create({ data: { url: 'https://example.com/old', reportingEntity: 'Preserved', fetchedAt: new Date(), memberships: { create: { npi: '1234567890', tinType: 'ein', tinValue: '000000000' } } } });
    const sourceUrl = 'https://example.com/fresh';
    const date = new Date(Date.now() - 86400000).toISOString().slice(0,10);
    const plans = [{ planName: 'Synthetic Plan', planId: '111111111', planIdType: 'ein' as const, planMarketType: 'group' }];
    const sourcePath = join(dir,'source.json'), tocPath = join(dir,'toc.json'), membershipPath = join(dir,'members.ndjson');
    await writeFile(sourcePath, '{}');
    await writeFile(tocPath, JSON.stringify({ reporting_structure: [{ in_network_files: [{ location: sourceUrl }], reporting_plans: [{ plan_name: 'Synthetic Plan', plan_id: '111111111', plan_id_type: 'ein', plan_market_type: 'group' }] }] }));
    const row = { npi: '1234567890', tin_type: 'ein', tin_value: '000000000', file_url: sourceUrl, reporting_entity: 'Synthetic', last_updated_on: date, schema: 'v1' };
    await writeFile(membershipPath, JSON.stringify(row)+'\n');
    const r = { version: 1 as const, scope: 'selected-file-only; plan completeness unverified' as const, sourceUrl, tocUrl:'https://example.com/index', sourcePath, tocPath, membershipPath,
      sourceSha256: await sha256(sourcePath), tocSha256: await sha256(tocPath), membershipSha256: await sha256(membershipPath), membershipCount:1,
      sourceDate:date, reportingEntity:'Synthetic', schema:'v1' as const, plans, preparedAt:new Date().toISOString() };
    await assert.rejects(publishPublication(db, { ...r, membershipSha256: '0'.repeat(64) }), /hash mismatch/);
    await assert.rejects(publishPublication(db, { ...r, membershipCount: 2 }), /count mismatch/);
    await assert.rejects(publishPublication(db, { ...r, plans: [{ ...plans[0], planId: '222222222' }] }), /Plan mapping differs/);
    await assert.rejects(publishPublication(db, { ...r, sourceDate:'2020-01-01' }), /stale/);
    assert.equal(await db.ticFile.count(), 1);
    passed.push('hash, count, TOC mapping and source-age failures cannot change existing data');
    // Duplicate rows pass metadata/hash validation but violate the real DB uniqueness constraint.
    // The whole new file must roll back, including batches inserted before the duplicate.
    const many = Array.from({length:1001},(_,i) => JSON.stringify({ ...row, npi: String(1000000000+i) }));
    many.push(many[0]);
    await writeFile(membershipPath, many.join('\n')+'\n');
    await assert.rejects(publishPublication(db, { ...r, membershipCount:many.length, membershipSha256:await sha256(membershipPath) }));
    assert.equal(await db.ticFile.count(), 1);
    assert.equal(await db.ticMembership.count(), 1);
    passed.push('failure after the first insertion batch rolls back the entire new publication');
    await writeFile(membershipPath, JSON.stringify(row)+'\n');
    const receipt = await publishPublication(db, r);
    assert.equal(receipt.memberships, 1); assert.equal(receipt.plans, 1);
    await assert.rejects(publishPublication(db, r), /already exists/);
    assert.equal(await db.ticMembership.count({ where: { fileId:old.id } }), 1);
    passed.push('successful publication is atomic and replay never overwrites an existing source');
    await db.ticFile.delete({ where: { id: receipt.fileId } });
    assert.equal(await db.ticFile.count(), 1);
    assert.equal(await db.ticMembership.count(), 1);
    passed.push('rollback by the new file ID removes only the new publication and preserves old data');
    const livePath = process.env.AFFINITY_TIC_PUBLICATION;
    if (livePath) {
      const live = await validatePublication(JSON.parse(await readFile(livePath, 'utf8')));
      const result = await publishPublication(db, live);
      assert.equal(result.memberships, live.membershipCount);
      const member = await db.ticMembership.findFirstOrThrow({ where: { fileId:result.fileId } });
      const link = await db.ticPlanLink.findFirstOrThrow({ where: { fileId:result.fileId } });
      const positive = await queryTicAnswer({ npi:member.npi, planIdType:link.planIdType, planId:link.planId, db });
      assert.equal(positive.value, 'yes'); assert.equal(positive.evidenceStatus, 'listed');
      const absent = await queryTicAnswer({ npi:'0000000000', planIdType:link.planIdType, planId:link.planId, db });
      assert.equal(absent.value, 'unknown');
      passed.push(`current archived source: ${result.memberships} memberships and ${result.plans} plan links published and joined correctly`);
      await db.ticFile.delete({ where: { id: result.fileId } });
      assert.equal(await db.ticFile.count(), 1);
    }
    console.log(JSON.stringify({ checkedAt:new Date().toISOString(), passed },null,2));
  } finally { await db.ticFile.deleteMany(); await db.$disconnect(); await rm(dir,{recursive:true,force:true}); }
}
main().catch(e=>{ console.error(e); process.exitCode=1; });
