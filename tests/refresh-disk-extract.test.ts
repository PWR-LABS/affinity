import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { createWriteStream, appendFileSync, renameSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzipSync, createGzip, deflateRawSync, crc32 } from 'node:zlib';
import { spawn } from 'node:child_process';
import { runDiskExtract, type DiskExtractOptions } from '../tools/tic-ingest/tic-extract-disk';
import { runExtract } from '../tools/tic-ingest/tic-extract';

const SOURCE = 'https://example.com/immutable-rate.json.gz';
const metadata = { reporting_entity_name: 'Local fixture', last_updated_on: '2026-11-01', version: '2.0.0' };
const group = (npi: unknown[] = [1234567890], type = 'ein', value = '111111111') => ({ npi, tin: { type, value } });
const rates = (body: unknown) => [{ negotiated_rates: [body] }];
const v2 = (groups: unknown[]) => ({ ...metadata, in_network: rates({ provider_groups: groups }) });
const v1 = (refs: unknown[], uses: unknown[] = [1]) => ({ ...metadata, provider_references: refs, in_network: rates({ provider_references: uses }) });
async function fixture(t: { after: (f: () => Promise<void>) => void }, bytes: string | Buffer = JSON.stringify(v2([group()]))) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'affinity-disk-extract-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scratchRoot = join(root, 'scratch'); await mkdir(scratchRoot);
  const input = join(root, 'source'), out = join(root, 'out.ndjson'); await writeFile(input, bytes);
  const options: DiskExtractOptions = { input, out, scratchRoot, sourceUrl: SOURCE };
  return { root, input, out, scratchRoot, options };
}
async function clean(scratch: string) { assert.deepEqual(await readdir(scratch), []); }
async function rejectsClean(t: Parameters<typeof fixture>[0], bytes: string | Buffer, error: RegExp, limits: Partial<DiskExtractOptions> = {}) {
  const f = await fixture(t, bytes); await writeFile(f.out, 'previous accepted output');
  await assert.rejects(runDiskExtract({ ...f.options, ...limits }), error);
  assert.equal(await readFile(f.out, 'utf8'), 'previous accepted output'); await clean(f.scratchRoot);
}

test('disk extraction matches legacy v1/v2 fixture output and counts byte for byte', async t => {
  for (const schema of ['v1', 'v2']) {
    const source = fileURLToPath(new URL(`../tools/tic-ingest/fixtures/tic-in-network-${schema}-sample.json`, import.meta.url));
    const f = await fixture(t, await readFile(source));
    const legacy = join(f.root, 'legacy.ndjson');
    const expected = await runExtract({ input: f.input, out: legacy, sourceUrl: SOURCE, progress: false });
    const actual = await runDiskExtract(f.options);
    assert.equal(await readFile(f.out, 'utf8'), await readFile(legacy, 'utf8'));
    for (const key of ['schema', 'pairs_emitted', 'npis_emitted', 'zero_npi_dropped', 'tin_in_npi_dropped'] as const) assert.equal(actual[key], expected[key]);
    assert.equal(actual.remote_refs_fetched, 0); assert.equal(actual.remote_refs_404, 0);
    await clean(f.scratchRoot);
  }
});

test('late IDs/TINs, rates before definitions, unused definitions and repeated uses preserve first-use tin type', async t => {
  const body = {
    in_network: rates({ provider_references: ['2', 1, 2, 1], provider_groups: [group([1999999999])] }),
    provider_references: [
      { provider_groups: [group()], provider_group_id: 1 },
      { provider_groups: [group([1234567890, 0, 0, 123456789], 'npi')], provider_group_id: 2 },
      { provider_groups: [group([1888888888])], provider_group_id: 'unused' },
    ], ...metadata,
  };
  const f = await fixture(t, JSON.stringify(body)), result = await runDiskExtract(f.options);
  const rows = (await readFile(f.out, 'utf8')).trim().split('\n').map(s => JSON.parse(s));
  assert.equal(result.schema, 'v1'); assert.equal(result.pairs_emitted, 1);
  assert.equal(result.zero_npi_dropped, 2); assert.equal(result.tin_in_npi_dropped, 1);
  assert.equal(rows[0].tin_type, 'npi'); assert.equal(rows[0].npi, '1234567890'); await clean(f.scratchRoot);
});

test('v2 pair deduplication, invalid NPI counters, key ordering and stable full-line sort match legacy', async t => {
  const body = v2([group([1234567890, 0, 123456789, 1234567890]), group([1234567890], 'NPI'), group([1234567890], 'ein', '1234567890'), group([1234567890], 'ein', '222222222')]);
  const f = await fixture(t, JSON.stringify(body));
  const expected = await runExtract({ input: f.input, sourceUrl: SOURCE, out: join(f.root, 'legacy'), progress: false });
  const actual = await runDiskExtract(f.options);
  assert.equal(await readFile(f.out, 'utf8'), await readFile(join(f.root, 'legacy'), 'utf8'));
  assert.equal(actual.pairs_emitted, expected.pairs_emitted); assert.equal(actual.tin_in_npi_dropped, expected.tin_in_npi_dropped);
  assert.equal(actual.npis_emitted, 1); await clean(f.scratchRoot);
});

test('repeated inline groups compact within a small scratch cap and a late root-reference array discards inline mode', async t => {
  const entry = JSON.stringify(group());
  const prefix = '{"in_network":[{"negotiated_rates":[{"provider_groups":[';
  const groups = (entry + ',').repeat(49_999) + entry;
  const suffix = ']}]}],';
  const f = await fixture(t, gzipSync(prefix + groups + suffix + JSON.stringify(metadata).slice(1)));
  const result = await runDiskExtract({ ...f.options, maxScratchBytes: 196_608 });
  assert.equal(result.pairs_emitted, 1); assert.equal(result.disk.groups, 50_000);
  assert.ok(result.disk.peakScratchBytes <= 196_608); await clean(f.scratchRoot);
  const late = await fixture(t, prefix + entry + suffix + '"provider_references":[],' + JSON.stringify(metadata).slice(1));
  const discarded = await runDiskExtract(late.options);
  assert.equal(discarded.schema, 'v1'); assert.equal(discarded.pairs_emitted, 0);
  assert.equal(await readFile(late.out, 'utf8'), ''); await clean(late.scratchRoot);
});

test('strict closure rejects unused external/malformed references, duplicate IDs and every unresolved use', async t => {
  const good = { provider_group_id: 1, provider_groups: [group()] };
  for (const bad of [
    { provider_group_id: 2, location: 'https://example.com/unarchived' },
    { provider_group_id: 2, provider_groups: [], location: 'https://example.com/unarchived' },
    { provider_group_id: 2 }, { provider_groups: [] }, { provider_group_id: 2, provider_groups: {} },
    { provider_group_id: {}, provider_groups: [] },
  ]) await rejectsClean(t, JSON.stringify(v1([good, bad])), /malformed provider reference|Malformed provider reference/);
  await rejectsClean(t, JSON.stringify(v1([good, { ...good, provider_group_id: '1' }])), /Duplicate provider reference/);
  for (const uses of [[1, 2], [''], [null], [{}], [[1]]]) await rejectsClean(t, JSON.stringify(v1([good], uses)), /Unresolved provider reference|must be scalar/);
  await rejectsClean(t, JSON.stringify({ ...metadata, in_network: rates({ provider_references: [1] }) }), /Unresolved provider reference/);
});

function zipJson(body: Buffer, wrongCrc = false) {
  const name = Buffer.from('rate.json'), compressed = deflateRawSync(body), sum = (crc32(body) + (wrongCrc ? 1 : 0)) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(sum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(sum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}

test('plain/gzip/ZIP require complete JSON EOF and gzip/ZIP CRC before replacing output', async t => {
  const body = Buffer.from(JSON.stringify(v2([group()])));
  for (const bytes of [body, gzipSync(body), zipJson(body)]) {
    const f = await fixture(t, bytes); assert.equal((await runDiskExtract(f.options)).pairs_emitted, 1); await clean(f.scratchRoot);
  }
  const corruptGzip = gzipSync(body); corruptGzip[corruptGzip.length - 8] ^= 1;
  for (const bytes of [Buffer.concat([body, Buffer.from(' trailing')]), body.subarray(0, -1), gzipSync(Buffer.concat([body, Buffer.from('!')])), corruptGzip, zipJson(body, true), zipJson(body).subarray(0, -1)]) {
    await rejectsClean(t, bytes, /JSON|Parser|expected|incorrect|CRC|ZIP|end|Unexpected/i);
  }
});

test('membership limit rejects excess unique pairs after full reference/tail validation, with no truncation', async t => {
  await rejectsClean(t, JSON.stringify(v2([group([1234567890, 1234567891])])), /Membership limit exceeded/, { maxPairs: 1 });
  const many = Array.from({ length: 200_001 }, (_, i) => 1000000000 + i);
  await rejectsClean(t, JSON.stringify(v2([group(many)])), /Membership limit exceeded/);
  const body = v1([{ provider_group_id: 1, provider_groups: [group([1234567890, 1234567891])] }, { provider_group_id: 2 }]);
  await rejectsClean(t, JSON.stringify(body), /malformed provider reference/, { maxPairs: 1 });
});

test('decode, scalar, depth, disk and time caps leave the existing output and clean scratch intact', async t => {
  await rejectsClean(t, gzipSync(JSON.stringify(v2([group()]))), /decoded_limit/, { maxDecodedBytes: 10 });
  await rejectsClean(t, JSON.stringify({ ignored: 'x'.repeat(65_537), ...v2([group()]) }), /scalar_limit/);
  await rejectsClean(t, '{"ignored":' + '['.repeat(66) + '0' + ']'.repeat(66) + '}', /depth_limit/);
  await rejectsClean(t, JSON.stringify(v2([group(Array.from({ length: 20_000 }, (_, i) => 1000000000 + i))])), /scratch_limit/, { maxScratchBytes: 196_608 });
  await rejectsClean(t, JSON.stringify(v2([group()])), /extraction_time_limit/, { maxMs: 1 });
});

test('disconnects abort before activation, clean recoverable scratch, and explicitly expose inaccessible cleanup', async t => {
  const f = await fixture(t); await writeFile(f.out, 'accepted'); let checks = 0;
  await assert.rejects(runDiskExtract({ ...f.options, guard() { if (++checks === 5) throw new Error('disconnected'); } }), /disconnected/);
  assert.equal(await readFile(f.out, 'utf8'), 'accepted'); await clean(f.scratchRoot);
  let online = true;
  await assert.rejects(runDiskExtract({ ...f.options, onProgress() { online = false; }, guard() { if (!online) throw new Error('ssd_disconnected'); } }), error => {
    assert.match(String(error), /ssd_disconnected/);
    assert.equal((error as Error & { cleanupPending: boolean }).cleanupPending, true);
    assert.ok((error as Error & { scratchPath: string }).scratchPath.startsWith(f.scratchRoot + '/.tic-disk-')); return true;
  });
  assert.equal(await readFile(f.out, 'utf8'), 'accepted');
  const zipped = await fixture(t, zipJson(Buffer.from(JSON.stringify(v2([group()])))));
  const deferral = new Error('caller-owned-storage-deferral'); let zipChecks = 0;
  await assert.rejects(runDiskExtract({ ...zipped.options, guard() { if (++zipChecks === 8) throw deferral; } }), error => error === deferral);
  await clean(zipped.scratchRoot);
});

test('changed source, duplicate keys and remote input fail closed', async t => {
  await rejectsClean(t, '{"provider_references":[],"provider_references":[]}', /Duplicate JSON object key/);
  const f = await fixture(t);
  await assert.rejects(runDiskExtract({ ...f.options, input: 'https://example.com/rate' }), /local archived/);
  await assert.rejects(runDiskExtract({ ...f.options, out: f.input }), /Output must/);
  let mutated = false;
  await assert.rejects(runDiskExtract({ ...f.options, onProgress() { if (!mutated) { mutated = true; requireMutation(f.input); } } }), /Source changed/);
  await clean(f.scratchRoot);
});

test('ignored price values remain syntax, size and duplicate-key validated without changing memberships',async t=>{
 const body=v1([{provider_group_id:1,provider_groups:[group()]}]);
 const text=JSON.stringify(body).replace('"provider_references":[1]','"negotiated_prices":[{"negotiated_rate":12.34,"ignored":[true,false,null,"text",{"nested":7}]}],"provider_references":[1]');
 const f=await fixture(t,text),legacy=join(f.root,'legacy');
 await runExtract({input:f.input,out:legacy,sourceUrl:SOURCE,progress:false});await runDiskExtract(f.options);
 assert.equal(await readFile(f.out,'utf8'),await readFile(legacy,'utf8'));
 await rejectsClean(t,text.replace('"negotiated_rate":12.34','"negotiated_rate":12.34,"negotiated_rate":9'),/Duplicate JSON object key/);
 await rejectsClean(t,text.replace('"text"',JSON.stringify('x'.repeat(65_537))),/scalar_limit/);
 await rejectsClean(t,text.replace('12.34','12.34e+'),/expected|number|parse/i);
 await rejectsClean(t,text.replace('"provider_references":[1]','"provider_references":1'),/Malformed provider reference/);
});

// The progress hook is synchronous; this only mutates a local, test-owned source.
function requireMutation(path: string) { appendFileSync(path, ' '); }

test('replacement scratch roots cannot receive writes or cleanup at a coincident path', async t => {
  const f = await fixture(t); let marker = '';
  await assert.rejects(runDiskExtract({ ...f.options, onProgress() {
    if (marker) return;
    const stage = readdirSync(f.scratchRoot)[0];
    renameSync(f.scratchRoot, f.scratchRoot + '-original'); mkdirSync(f.scratchRoot);
    const replacement = join(f.scratchRoot, stage); mkdirSync(replacement);
    marker = join(replacement, 'unrelated'); writeFileSync(marker, 'preserve');
  } }), error => {
    assert.match(String(error), /Scratch root changed/);
    assert.equal((error as Error & { cleanupPending: boolean }).cleanupPending, true); return true;
  });
  assert.equal(await readFile(marker, 'utf8'), 'preserve');
});

test('giant unused references and a giant used NPI array complete under a 32 MiB heap', { timeout: 240_000 }, async t => {
  const f = await fixture(t), input = join(f.root, 'giant.json.gz');
  async function* chunks() {
    yield '{"in_network":[{"negotiated_rates":[{"provider_references":["used"]}]}],"provider_references":[{"provider_groups":[';
    for (let i = 0; i < 100_000; i++) yield (i ? ',' : '') + JSON.stringify(group([1000000000 + i]));
    yield '],"provider_group_id":"unused"},{"provider_groups":[{"npi":[';
    const block = '1234567890,'.repeat(1000);
    for (let i = 0; i < 3000; i++) yield block;
    yield '1234567890],"tin":{"value":"111111111","type":"ein"}}],"provider_group_id":"used"}],';
    yield JSON.stringify(metadata).slice(1);
  }
  await pipeline(Readable.from(chunks(), { objectMode: false }), createGzip(), createWriteStream(input));
  const moduleUrl = new URL('../tools/tic-ingest/tic-extract-disk.ts', import.meta.url).href;
  const code = `import {runDiskExtract} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(await runDiskExtract(${JSON.stringify({ ...f.options, input })})));`;
  const child = spawn(process.execPath, ['--max-old-space-size=32', '--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += String(b); }); child.stderr.on('data', b => { stderr += String(b); });
  const codeResult = await new Promise<number | null>((yes, no) => { child.once('error', no); child.once('exit', yes); });
  assert.equal(codeResult, 0, stderr); const result = JSON.parse(stdout);
  assert.equal(result.schema, 'v1'); assert.equal(result.pairs_emitted, 1);
  assert.equal(result.disk.groups, 100_001); assert.ok(result.disk.decodedBytes > 32 * 1024 * 1024);
  assert.ok(result.disk.peakScratchBytes > 2 * 1024 * 1024); assert.equal(result.disk.cleanupPending, undefined);
  t.diagnostic(JSON.stringify({ decodedBytes: result.disk.decodedBytes, scratchBytes: result.disk.peakScratchBytes, peakRssMiB: result.peak_rss_mb, seconds: result.seconds }));
  assert.equal((await readFile(f.out, 'utf8')).trim().split('\n').length, 1);
  assert.ok((await stat(input)).size > 0); await clean(f.scratchRoot);
});

test('larger complete local extractions retain explicit limits and preserve the legacy cloud cap',async t=>{
 const f=await fixture(t,JSON.stringify(v2([group(Array.from({length:200001},(_,i)=>1000000000+i))])));
 await assert.rejects(runDiskExtract(f.options),/Membership limit exceeded/);
 const result=await runDiskExtract({...f.options,maxPairs:200001});assert.equal(result.pairs_emitted,200001);
 const {extractionAcceptanceSchema}=await import('../src/lib/tic/source-proof');
 assert.equal(extractionAcceptanceSchema.safeParse({...result,sourceSha256:'a'.repeat(64),sourceBytes:1,membershipSha256:'b'.repeat(64),tocSha256:'c'.repeat(64)}).success,true);
 const {REFRESH_POLICY}=await import('../scripts/lib/refresh-policy');assert.equal(REFRESH_POLICY.memberships,200000);assert.equal(REFRESH_POLICY.scratchBytes,4000000000);
 await clean(f.scratchRoot);
});

test('interned reference groups preserve first-use ordering and exact duplicate drop counts',async t=>{
 const a=group([1234567890,0,0,123456789,1234567890]);
 const reordered=group([123456789,1234567890,0,1234567890,0]);
 const b=group([1234567890,0],'npi');
 const body=v1([{provider_group_id:1,provider_groups:[a,a,b,reordered]},{provider_group_id:2,provider_groups:[b,a,b]},{provider_group_id:3,provider_groups:[a]}],[2,1,2]);
 const f=await fixture(t,JSON.stringify(body));const old=await runExtract({input:f.input,out:join(f.root,'legacy'),sourceUrl:SOURCE,progress:false});const result=await runDiskExtract(f.options);
 assert.equal(await readFile(f.out,'utf8'),await readFile(join(f.root,'legacy'),'utf8'));
 for(const key of ['pairs_emitted','npis_emitted','zero_npi_dropped','tin_in_npi_dropped'] as const)assert.equal(result[key],old[key]);
 assert.equal(JSON.parse((await readFile(f.out,'utf8')).trim()).tin_type,'npi');await clean(f.scratchRoot);
});
test('repeated reference catalogs remain complete within a bounded scratch budget',async t=>{
 const refs=Array.from({length:500},(_,i)=>({provider_group_id:i,provider_groups:Array.from({length:200},()=>group([1234567890,0,123456789]))}));
 const f=await fixture(t,JSON.stringify(v1(refs,refs.map(r=>r.provider_group_id))));
 const result=await runDiskExtract({...f.options,maxScratchBytes:524288});
 assert.equal(result.disk.groups,100000);assert.equal(result.disk.references,500);assert.equal(result.pairs_emitted,1);
 assert.equal(result.zero_npi_dropped,100000);assert.equal(result.tin_in_npi_dropped,100000);assert.ok(result.disk.peakScratchBytes<=524288);await clean(f.scratchRoot);
});
