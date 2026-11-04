import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { buildSelectedToc, SelectedTocError, type SelectedTocOptions } from './selected-toc';

const NOW = new Date('2026-11-04T21:00:00Z'), DATE = '2026-11-01';
const A = 'https://anthembcbsoh.example/2026-11_A_in-network-rates.json.gz';
const B = 'https://anthembcbsoh.example/2026-11_B_in-network-rates.json.gz';
const C = 'https://anthembcbsoh.example/2026-11_C_in-network-rates.json.gz';
const plan = (id: string, extra: Record<string, unknown> = {}) => ({
  plan_name: 'Fixture plan ' + id, plan_id_type: 'EIN', plan_id: id, plan_market_type: 'group',
  issuer_name: 'Anthem Inc', plan_sponsor_name: 'Fictional employer', ...extra,
});
const structure = (files: string[], plans: unknown[] = [plan('123456789')]) => ({
  reporting_plans: plans, in_network_files: files.map(location => ({ location, description: 'Fixture network' })),
});
const toc = (structures: unknown[], meta: Record<string, unknown> = {}) => ({
  reporting_structure: structures, reporting_entity_name: 'Anthem Inc', reporting_entity_type: 'health insurance issuer',
  last_updated_on: DATE, version: '2.0.0', ...meta,
});
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: { after: (fn: () => Promise<void>) => void }, content: unknown = toc([structure([A])]), selected: string[] = [A]) {
  const root = await mkdtemp(join(tmpdir(), 'affinity-selected-toc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outDir = join(root, 'out'), input = join(root, 'parent.json.gz'), selection = join(root, 'selected.json');
  await mkdir(outDir);
  await writeFile(input, gzipSync(Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))));
  await writeFile(selection, JSON.stringify(selected));
  return { root, outDir, input, selected: selection, now: NOW };
}
async function readReceipt(result: { receiptPath: string }) { return JSON.parse(await readFile(result.receiptPath, 'utf8')); }
async function rejected(options: SelectedTocOptions, code?: string) {
  await assert.rejects(buildSelectedToc(options), e => e instanceof SelectedTocError && (!code || e.code === code));
}

test('preserves complete exact mappings and metadata, deduplicates across structures, and binds every projection to full parent hash', async t => {
  const p1 = plan('123456789', { annotations: ['a', true, null], tier: 2 });
  const p2 = plan('123456789', { plan_sponsor_name: 'Different source sponsor' });
  const f = await fixture(t, toc([
    structure([A + '?&Expires=1&Signature=old', B], [p1]),
    structure([A + '?Expires=2&Signature=new'], [p1, p2]),
    structure([C]),
  ], { source_note: 'Metadata after structures is retained' }), [A + '?Signature=selected-signature', '/2026-11_B_in-network-rates.json.gz', 'https://missing.example/not-in-parent.json.gz']);
  const r = await buildSelectedToc(f), receipt = await readReceipt(r);
  assert.equal(r.parentSha256, sha(await readFile(f.input)));
  assert.equal(r.projected, 2); assert.equal(r.unresolved, 1);
  assert.equal(receipt.parent.validatedJsonEof, true); assert.equal(receipt.parent.sourceDate, DATE);
  assert.equal(receipt.parent.metadata.source_note, 'Metadata after structures is retained');
  for (const output of receipt.projections) {
    const gzip = await readFile(join(r.directory, output.file)), plain = gunzipSync(gzip), j = JSON.parse(plain.toString());
    assert.equal(output.parentSha256, r.parentSha256); assert.equal(output.sha256, sha(gzip));
    assert.equal(output.decodedSha256, sha(plain)); assert.equal(output.bytes, gzip.length);
    assert.equal(j.reporting_entity_name, 'Anthem Inc'); assert.equal(j.source_note, receipt.parent.metadata.source_note);
    const a = output.selected.startsWith(A);
    assert.deepEqual(new Set(j.reporting_structure[0].reporting_plans), new Set(a ? [p1, p2] : [p1]));
    assert.equal(output.plans, a ? 2 : 1); assert.equal(output.references, a ? 2 : 1);
    assert.match(output.scope, /selected-file-only/);
  }
  assert.deepEqual((await readdir(r.directory)).filter(s => s.endsWith('.sqlite')), []);
  assert.equal(receipt.unresolved[0].selected, 'https://missing.example/not-in-parent.json.gz');
  const again = await buildSelectedToc(f), receipt2 = await readReceipt(again);
  assert.deepEqual(receipt.projections.map((p: {sha256: string}) => p.sha256), receipt2.projections.map((p: {sha256: string}) => p.sha256));
});

test('number literals and non-signature query text survive; only known transport signatures match', async t => {
  const source = JSON.stringify(toc([
    structure([A + '?network=one&Signature=x'], [plan('123456789', { precise: 'PLACEHOLDER' })]),
    structure([A + '?network=two&Signature=y']),
  ])).replace('"PLACEHOLDER"', '9007199254740993');
  const f = await fixture(t, source, [A + '?network=one&Signature=other', A + '?network=two', A]);
  const r = await buildSelectedToc(f), receipt = await readReceipt(r);
  assert.equal(r.projected, 2); assert.equal(r.unresolved, 1);
  const output = receipt.projections.find((x: { selected: string }) => x.selected.includes('network=one'));
  assert.match(gunzipSync(await readFile(join(r.directory, output.file))).toString(), /"precise":9007199254740993/);
});

test('ambiguous selected paths and overlapping URL/path selections fail closed', async t => {
  const other = A.replace('anthembcbsoh.example', 'other-host.example');
  for (const selected of [['/2026-11_A_in-network-rates.json.gz'], [A, '/2026-11_A_in-network-rates.json.gz']]) {
    const f = await fixture(t, toc([structure([A]), structure([other])]), selected);
    await rejected(f, 'mapping'); assert.deepEqual(await readdir(f.outDir), []);
  }
});

test('valid gzip with truncated JSON, truncated gzip, trailing values, and invalid CRC cannot publish early projections', async t => {
  for (const mode of ['json', 'gzip', 'trailing', 'crc']) {
    const content = JSON.stringify(toc([structure([A])]));
    const f = await fixture(t, mode === 'json' ? content.slice(0, -1) : mode === 'trailing' ? content + '{}' : content);
    if (mode === 'gzip' || mode === 'crc') {
      const b = await readFile(f.input);
      if (mode === 'gzip') await writeFile(f.input, b.subarray(0, -4));
      else { b[b.length - 8] ^= 1; await writeFile(f.input, b); }
    }
    await rejected(f); assert.deepEqual(await readdir(f.outDir), []);
  }
});

test('stale, future, impossible dates and wrong entity metadata fail even after selected mappings were seen', async t => {
  for (const meta of [{ last_updated_on: '2026-07-01' }, { last_updated_on: '2026-11-05' },
    { last_updated_on: '2026-02-30' }, { reporting_entity_name: 'Other issuer' }]) {
    const f = await fixture(t, toc([structure([A])], meta));
    await rejected(f, 'source'); assert.deepEqual(await readdir(f.outDir), []);
  }
});

test('malformed unselected mappings and duplicate JSON keys are rejected rather than skipped', async t => {
  for (const malformed of [
    toc([structure([A]), { reporting_plans: [], in_network_files: [{ location: C }] }]),
    toc([structure([A]), structure(['not-a-url'])]),
    toc([structure([A]), structure([C], [plan('1', { plan_id_type: 'bogus' })])]),
    JSON.stringify(toc([structure([A])])).replace('"version":"2.0.0"', '"version":"2.0.0","version":"2.0.1"'),
  ]) {
    const f = await fixture(t, malformed); await rejected(f); assert.deepEqual(await readdir(f.outDir), []);
  }
});

test('invalid UTF-8 cannot silently replace source characters in a projection', async t => {
  const f = await fixture(t), raw = Buffer.from(JSON.stringify(toc([structure([A])], { note: 'REPLACE' })));
  const i = raw.indexOf('REPLACE');
  await writeFile(f.input, gzipSync(Buffer.concat([raw.subarray(0, i), Buffer.from([0xc3, 0x28]), raw.subarray(i + 7)])));
  await rejected(f, 'parse'); assert.deepEqual(await readdir(f.outDir), []);
});

test('selection, scalar, single-structure, node, depth and cumulative mapping caps are enforced', async t => {
  const cases: Array<{ content?: unknown; selected?: string[]; limits: SelectedTocOptions['limits'] }> = [
    { selected: Array.from({ length: 401 }, (_, i) => A + '?semantic=' + i), limits: {} },
    { limits: { scalarBytes: 16 } },
    { limits: { structureBytes: 100 } },
    { limits: { structureNodes: 10 } },
    { limits: { depth: 2 } },
    { content: toc([structure([A], [plan('1')]), structure([A], [plan('2')])]), limits: { plansPerFile: 1 } },
    { content: toc([structure([A + '?Signature=x']), structure([A + '?Signature=y'])]), limits: { referencesPerFile: 1 } },
    { limits: { decodedBytes: 64 } },
    { limits: { projectionBytes: 64 } },
    { limits: { projectionGzipBytes: 8 } },
    { limits: { receiptBytes: 32 } },
  ];
  for (const c of cases) {
    t.diagnostic(JSON.stringify(c.limits));
    const f = await fixture(t, c.content, c.selected); await rejected({ ...f, limits: c.limits }, 'limit');
    assert.deepEqual(await readdir(f.outDir), []);
  }
});

test('SQLite disk cap fails without committing projections or leaving scratch files', async t => {
  const f = await fixture(t, toc(Array.from({ length: 300 }, (_, i) => structure([A], [plan(String(i), { payload: 'x'.repeat(1000) })]))));
  await rejected({ ...f, limits: { tempBytes: 65_536 } }, 'limit'); assert.deepEqual(await readdir(f.outDir), []);
});

test('missing output roots are not recreated, and a transient guard disconnect cleans its own scratch directory', async t => {
  const f = await fixture(t);
  await rejected({ ...f, outDir: join(f.root, 'missing', 'out') }, 'storage');
  assert.deepEqual((await readdir(f.root)).sort(), ['out', 'parent.json.gz', 'selected.json']);
  let n = 0;
  await rejected({ ...f, guard() { if (++n === 10) throw new Error('Disconnected'); } }, 'storage');
  assert.deepEqual(await readdir(f.outDir), []);
});

test('persistent guard loss does not clean an unverified replacement volume or commit a directory', async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(buildSelectedToc({ ...f, guard() { if (++calls >= 10) throw new Error('Volume identity unavailable'); } }),
    e => e instanceof SelectedTocError && e.code === 'storage' && e.cleanupPending && Boolean(e.temporaryPath));
  assert.ok((await readdir(f.outDir)).every(n => n.startsWith('.selected-toc-')));
});

test('parent modification during processing invalidates the whole result', async t => {
  const f = await fixture(t), original = await readFile(f.input); let calls = 0;
  await rejected({ ...f, guard() { if (++calls === 9) writeFileSync(f.input, Buffer.concat([original, Buffer.from([0])])); } });
  assert.deepEqual(await readdir(f.outDir), []);
});

test('disk-backed mapping fixture completes with 60000 distinct two-kilobyte plans under a 64 MiB old-space limit', { timeout: 180_000 }, async t => {
  const f = await fixture(t), files = Array.from({ length: 12 }, (_, i) => 'https://fixture.example/network-' + i + '.json.gz');
  await writeFile(f.selected, JSON.stringify(files));
  async function* source() {
    yield '{"reporting_entity_name":"Anthem Inc","reporting_entity_type":"health insurance issuer","last_updated_on":"' + DATE + '","version":"2.0.0","reporting_structure":[';
    for (let i = 0; i < 60_000; i++) yield (i ? ',' : '') + JSON.stringify(structure([files[i % files.length]], [plan(String(100000000 + i), { payload: 'x'.repeat(2048) })]));
    yield ']}';
  }
  await pipeline(Readable.from(source()), createGzip(), createWriteStream(f.input));
  const tool = fileURLToPath(new URL('./selected-toc.ts', import.meta.url));
  const child = spawn(process.execPath, ['--max-old-space-size=64', '--import', 'tsx', tool,
    '--in', f.input, '--selected', f.selected, '--out-dir', f.outDir], { cwd: dirname(tool), stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(120_000) });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const exit = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(exit, 0, stderr);
  const r = JSON.parse(stdout), receipt = await readReceipt(r);
  assert.equal(r.projected, 12); assert.equal(r.unresolved, 0);
  assert.equal(receipt.projections.reduce((sum: number, p: { plans: number }) => sum + p.plans, 0), 60_000);
  assert.ok(receipt.parent.decodedBytes > 130_000_000);
  assert.ok(receipt.stats.peakTempBytes > 100_000_000, 'Distinct plan payloads must really be stored on disk');
  assert.ok(receipt.stats.peakRssMiB < 256, 'RSS includes SQLite, gzip and Node native allocations');
  t.diagnostic(JSON.stringify({ decodedBytes: receipt.parent.decodedBytes, mappings: 60_000, peakTempBytes: receipt.stats.peakTempBytes, peakRssMiB: receipt.stats.peakRssMiB }));
});

test('real Anthem optional plan name omission is preserved without inventing metadata',async t=>{
 const unnamed={plan_id_type:'EIN',plan_id:'351863470',plan_sponsor_name:'Fixture sponsor',plan_market_type:'group'};
 const f=await fixture(t,toc([structure([A],[unnamed])]));
 const result=await buildSelectedToc(f),r=await readReceipt(result);
 const projected=JSON.parse(gunzipSync(await readFile(join(result.directory,r.projections[0].file))).toString());
 assert.deepEqual(projected.reporting_structure[0].reporting_plans,[unnamed]);
 const {tocPlans}=await import('../../src/lib/tic/publication');
 const mapped=await tocPlans(join(result.directory,r.projections[0].file),A);
 assert.equal(mapped[0].planName,'');assert.equal(mapped[0].planId,'351863470');
 const malformed=await fixture(t,toc([structure([A],[{...unnamed,plan_name:23}])]));await rejected(malformed,'mapping');
});

test('explicit compact employer scope preserves all matching plan variants and reports excluded sources',async t=>{
 const f=await fixture(t,toc([structure([A],[plan('111111111'),plan('222222222')]),structure([A],[plan('111111111',{plan_name:'Second exact plan'})]),structure([B],[plan('222222222')])]),[A,B]);
 const result=await buildSelectedToc({...f,planIdentities:['ein:111111111']}),r=await readReceipt(result);
 assert.equal(r.projections.length,1);assert.equal(r.projections[0].plans,2);
 assert.equal(r.unresolved.length,1);assert.match(r.unresolved[0].reason,/explicit employer scope/);
 assert.deepEqual(r.planSelection.identities,['ein:111111111']);
 const data=JSON.parse(gunzipSync(await readFile(join(result.directory,r.projections[0].file))).toString());
 assert.ok(data.reporting_structure[0].reporting_plans.every((p:{plan_id:string})=>p.plan_id==='111111111'));
});
