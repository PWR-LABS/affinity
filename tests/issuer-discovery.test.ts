import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, gzipSync, gunzipSync } from 'node:zlib';
import { CIGNA_NETWORKS, createIssuerDiscoverer, IssuerDiscoveryError } from '../scripts/lib/issuer-discovery';

const PAGE = 'https://www.cigna.com/legal/compliance/machine-readable-files';
const LATEST = 'https://www.cigna.com/static/mrf/latest.json';
const DATE = '2026-11-01';
const NOW = () => new Date('2026-11-04T21:00:00Z');
const MEMBER = DATE + '_cigna-health-life-insurance-company_index.json';
const ZIP = 'https://d25kgz5rikkq4n.cloudfront.net/cost_transparency/mrf/table-of-contents-zip/reporting_month=2026-11/' + DATE + '_cigna-partners-toc-collection.zip?Signature=do-not-log-this';
const RATE = 'https://d25kgz5rikkq4n.cloudfront.net/cost_transparency/mrf/in-network-rates/reporting_month=2026-11/' + DATE + '_cigna-health-life-insurance-company_';
const MMO_PAGE = 'https://www.medmutual.com/Employers/No-Surprises-Act-Transparency-Under-the-Consolidated-Appropriations-Act-2021.aspx';
const MMO_ROUTE = 'https://www.medmutual.com/mrf';
const MMO_PORTAL = 'https://medmutual.healthsparq.com/healthsparq/public/#/one/insurerCode=MMO_I&brandCode=MMO&productCode=MRF/machine-readable-transparency-in-coverage';
const MMO_TOC = 'https://mrf.healthsparq.com/mmo-egress.nophi.kyruushsq.com/prd/mrf/MMO_I/MMO/' + DATE + '/tableOfContents/' + DATE + '_Medical-Mutual-Of-Ohio_index.json.gz';
const EAST1 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/';
const EAST2 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east2.s3.us-east-2.amazonaws.com/';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function crc(bytes: Buffer) {
  let c = 0xffffffff;
  for (const x of bytes) { c ^= x; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries: Array<{ name: string; body: Buffer }>) {
  const locals: Buffer[] = [], directory: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), encoded = deflateRawSync(e.body), sum = crc(e.body);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(sum, 14); local.writeUInt32LE(encoded.length, 18);
    local.writeUInt32LE(e.body.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(encoded.length, 20); central.writeUInt32LE(e.body.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, encoded); directory.push(central, name); offset += local.length + name.length + encoded.length;
  }
  const dir = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
const plan = { plan_id_type: 'EIN', plan_id: '123456789', plan_name: 'Fixture plan', plan_market_type: 'group' };
function toc(entity: string, files: string[], sourceDate = DATE) {
  return { reporting_entity_name: entity, last_updated_on: sourceDate, version: '2.0.1',
    reporting_structure: files.map(location => ({ reporting_plans: [plan], in_network_files: [{ location }] })) };
}
const rate = (name: string) => RATE + name + '_in-network-rates.json.gz?Signature=rate-signature';
function cignaRoutes(body?: Buffer, memberName = MEMBER) {
  const primary = body ?? Buffer.from(JSON.stringify(toc('Cigna Health Life Insurance Company', CIGNA_NETWORKS.filter(n => !['tampa-ipa-mixed-hmo', 'metro-ny-seamless-hmo-network'].includes(n)).map(rate))));
  return new Map<string, () => Response>([
    [PAGE, () => new Response('<div data-mrf-lookup-url="/static/mrf/latest.json"></div>')],
    [LATEST, () => Response.json({ mrfs: [{ program: 'cost_transparency', kind: 'TOC', files: [{
      last_updated_on: DATE, file_name: DATE + '_cigna-partners-toc-collection.zip', url: ZIP,
    }] }] })],
    [ZIP, () => new Response(zip([{ name: memberName, body: primary }]))],
  ]);
}
function fetchRoutes(routes: Map<string, () => Response>, calls: string[]) {
  return (async (input: string | URL | Request) => {
    const u = String(input); calls.push(u); const route = routes.get(u);
    if (!route) throw new Error('Unexpected request (could be a signed URL; must be sanitized)');
    return route();
  }) as typeof fetch;
}
async function root(t: { after: (fn: () => Promise<void>) => void }) {
  const p = await mkdtemp(join(tmpdir(), 'affinity-discovery-')); t.after(() => rm(p, { recursive: true, force: true })); return p;
}
async function manifest(rootPath: string) {
  const [run] = await readdir(rootPath);
  return JSON.parse(await readFile(join(rootPath, run, 'manifest.json'), 'utf8'));
}
async function rejectedCode(work: Promise<unknown>, expected: string) {
  await assert.rejects(work, e => e instanceof IssuerDiscoveryError && e.code === expected && !e.message.includes('Signature='));
}

test('Cigna rediscovers, preserves raw ZIP/member hashes and exact signed source mappings; unresolved stays explicit', async t => {
  const p = await root(t), calls: string[] = [], routes = cignaRoutes();
  const discover = createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW });
  const r = await discover('cigna', p);
  assert.equal(r.sourceDate, DATE); assert.equal(r.tocUrl, ZIP); assert.equal(r.candidates.length, 14);
  assert.ok(r.candidates.every(c => c.url.includes('Signature=rate-signature') && !c.stableKey.includes('?')));
  assert.match(r.scope, /14\/16/); assert.match(r.scope, /tampa-ipa-mixed-hmo/);
  assert.deepEqual(calls, [PAGE, LATEST, ZIP]); // No rate or provider-reference request.
  const m = await manifest(p);
  assert.equal(m.status, 'partial'); assert.equal(m.unresolved.length, 2);
  const raw = await routes.get(ZIP)!().arrayBuffer();
  assert.equal(m.zipMember.parentSha256, sha(new Uint8Array(raw)));
  const normalized = await readFile(r.tocPath), primary = gunzipSync(normalized);
  assert.equal(sha(primary), m.zipMember.sha256);
  assert.equal(sha(normalized), m.derived[0].sha256);
  assert.equal(sha(normalized), sha(gzipSync(primary))); // Deterministic derived gzip.
  assert.ok(!JSON.stringify(m).includes('do-not-log-this'));
  assert.ok(!JSON.stringify(m).includes('rate-signature'));
  assert.equal((await stat(join(dirname(r.tocPath), m.downloads[2].file))).mode & 0o777, 0o600);
});

test('signed URL churn does not change Cigna stable network identities', async t => {
  const p = await root(t), routes = cignaRoutes(Buffer.from(JSON.stringify(toc('Cigna Health Life Insurance Company', [
    rate('wichita-gppo'), rate('wichita-gppo').replace('rate-signature', 'other-signature'),
  ]))));
  const r = await createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('cigna', p);
  assert.deepEqual(r.candidates, [{ url: rate('wichita-gppo'), stableKey: 'cigna:wichita-gppo' }]);
  assert.equal((await manifest(p)).unresolved.length, 15);
});

test('Medical Mutual resolves official /mrf identity and validates actual TOC date; external URLs stay inventoried', async t => {
  const p = await root(t), calls: string[] = [];
  const current = MMO_TOC.replace('tableOfContents/', 'inNetworkRates/').replace('_Medical-Mutual-Of-Ohio_index', '_01_Medical-Mutual-Of-Ohio');
  const body = gzipSync(Buffer.from(JSON.stringify(toc('Medical Mutual Of Ohio', [current, current, 'https://external.example/shared-network.zip']))));
  const routes = new Map<string, () => Response>([
    [MMO_PAGE, () => new Response('<a href="http://www.medmutual.com/mrf">files</a>')],
    [MMO_ROUTE, () => new Response('', { status: 302, headers: { location: MMO_PORTAL } })],
    [MMO_TOC, () => new Response(body)],
  ]);
  let guards = 0;
  const r = await createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW })('mmoh', p, { guard: () => { guards++; } });
  assert.equal(r.candidates.length, 2); assert.equal(r.sourceDate, DATE); assert.equal(r.tocUrl, MMO_TOC);
  assert.ok(r.candidates.some(x => x.stableKey.includes('{date}')));
  assert.deepEqual(calls, [MMO_PAGE, MMO_ROUTE, MMO_TOC]);
  assert.equal((await readFile(r.tocPath)).equals(body), true);
  const m = await manifest(p); assert.match(m.resolution, /no previous-month fallback/); assert.ok(guards > 10);
});

test('Anthem archives official resolver and HEAD size then returns a typed block without reading the TOC', async t => {
  const p = await root(t), calls: string[] = [], tocUrl = EAST1 + 'anthem/' + DATE + '_anthem_index.json.gz';
  const routes = new Map<string, () => Response>([
    ['https://www.anthem.com/machine-readable-file/search/', () => new Response('<script src="script.js"></script>')],
    ['https://www.anthem.com/machine-readable-file/search/script.js', () => new Response(EAST1 + EAST2 + ' status.json _anthem_index.json.gz')],
    [EAST1 + 'status.json', () => new Response('{"status":"true"}')],
    [tocUrl, () => new Response(null, { headers: { 'content-length': '11517571151' } })],
  ]);
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW })('anthem', p), 'blocked_large_toc');
  const m = await manifest(p);
  assert.equal(m.status, 'blocked'); assert.equal(m.blockedInventory.contentLength, '11517571151');
  assert.equal(m.blockedInventory.sourceDate, null); assert.equal(m.downloads.at(-1).method, 'HEAD');
  assert.equal(calls.length, 4); assert.match(m.blockedInventory.action, /EIN samples are not canonical/);
});

test('changed official identity, future/stale dates, and mismatched resolver dates fail closed', async t => {
  for (const sourceDate of ['2026-11-05', '2026-08-01', '2026-10-01', '2026-02-30']) {
    const p = await root(t), routes = cignaRoutes(Buffer.from(JSON.stringify(toc('Cigna Health Life Insurance Company', [rate('wichita-gppo')], sourceDate))));
    await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('cigna', p), 'invalid_source');
  }
  const p = await root(t), routes = cignaRoutes(); routes.set(PAGE, () => new Response('<div>changed portal</div>'));
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('cigna', p), 'unsupported');
});

test('hostile ZIP paths, absent primary, duplicate members, corruption and excessive decoded lengths fail', async t => {
  for (const name of ['../' + MEMBER, '/' + MEMBER, 'other.json']) {
    const p = await root(t);
    await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(cignaRoutes(undefined, name), []), now: NOW })('cigna', p), 'invalid_source');
  }
  for (const mode of ['duplicate', 'crc', 'decoded']) {
    const p = await root(t), body = Buffer.from(JSON.stringify(toc('Cigna Health Life Insurance Company', [rate('wichita-gppo')])));
    let archive = zip([{ name: MEMBER, body }, ...(mode === 'duplicate' ? [{ name: MEMBER, body }] : [])]);
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (mode === 'crc') archive.writeUInt32LE(0, central + 16);
    if (mode === 'decoded') archive.writeUInt32LE(100_000_001, central + 24);
    const routes = cignaRoutes(); routes.set(ZIP, () => new Response(archive));
    await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('cigna', p), mode === 'decoded' ? 'limit' : 'invalid_source');
  }
});

test('advertised and streamed byte overruns, HTTP failures and untrusted redirects are bounded and redacted', async t => {
  for (const mode of ['header', 'stream', 'http', 'redirect']) {
    const p = await root(t), calls: string[] = [], routes = cignaRoutes();
    routes.set(PAGE, () => mode === 'header' ? new Response('x', { headers: { 'content-length': '2000001' } }) :
      mode === 'stream' ? new Response(new Uint8Array(2_000_001)) :
      mode === 'http' ? new Response('unavailable', { status: 503 }) :
      new Response('', { status: 302, headers: { location: 'https://untrusted.example/?Signature=do-not-log-this' } }));
    await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW })('cigna', p),
      mode === 'http' ? 'http' : mode === 'redirect' ? 'invalid_source' : 'limit');
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(await manifest(p)).includes('do-not-log-this'));
  }
});

test('fetch and response-stream stalls stop within request deadlines', async t => {
  for (const mode of ['fetch', 'body']) {
    const p = await root(t);
    const fetcher = (async () => mode === 'fetch' ?
      await new Promise<Response>(resolve => setTimeout(() => resolve(new Response('late')), 120)) :
      new Response(new ReadableStream({ async pull(controller) { await new Promise(resolve => setTimeout(resolve, 120)); try { controller.close(); } catch {} } }))) as typeof fetch;
    await rejectedCode(createIssuerDiscoverer({ fetch: fetcher, now: NOW, limits: { requestMs: 15 } })('cigna', p), 'timeout');
    assert.equal((await manifest(p)).error.code, 'timeout');
  }
});

test('archive roots are never recreated and device guard loss during streaming cannot make a phantom directory', async t => {
  const p = await root(t), missing = join(p, 'vanished-volume', 'archive');
  await rejectedCode(createIssuerDiscoverer({ now: NOW })('cigna', missing), 'archive');
  await assert.rejects(stat(join(p, 'vanished-volume')), { code: 'ENOENT' });
  const archiveRoot = await root(t); let mounted = true, guardCalls = 0;
  const fetcher = (async () => new Response(new ReadableStream({
    async pull(controller) {
      await rm(archiveRoot, { recursive: true, force: true }); mounted = false;
      controller.enqueue(Buffer.from('partial')); controller.close();
    },
  }))) as typeof fetch;
  await rejectedCode(createIssuerDiscoverer({ fetch: fetcher, now: NOW })('cigna', archiveRoot, {}, {
    guard() { guardCalls++; if (!mounted) throw new Error('Device vanished'); },
  }), 'archive');
  assert.ok(guardCalls >= 4);
  await assert.rejects(stat(archiveRoot), { code: 'ENOENT' });
});

test('semantic query parameters cannot silently merge distinct MMO source files', async t => {
  const p = await root(t);
  const routes = new Map<string, () => Response>([
    [MMO_PAGE, () => new Response('<a href="https://www.medmutual.com/mrf">files</a>')],
    [MMO_ROUTE, () => new Response('', { status: 302, headers: { location: MMO_PORTAL } })],
    [MMO_TOC, () => new Response(gzipSync(Buffer.from(JSON.stringify(toc('Medical Mutual Of Ohio', [
      'https://external.example/download?network=a&Signature=one',
      'https://external.example/download?network=b&Signature=two',
      'https://external.example/download?network=a&Signature=changed',
    ])))))],
  ]);
  const r = await createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('mmoh', p);
  assert.equal(r.candidates.length, 2); assert.notEqual(r.candidates[0].stableKey, r.candidates[1].stableKey);
  assert.ok(r.candidates.every(c => !c.stableKey.includes('network=')));
});

test('MMO rejects stale locator data and changed portal identity without falling back to older months', async t => {
  for (const mode of ['date', 'identity']) {
    const p = await root(t), calls: string[] = [];
    const routes = new Map<string, () => Response>([
      [MMO_PAGE, () => new Response('<a href="https://www.medmutual.com/mrf">files</a>')],
      [MMO_ROUTE, () => new Response('', { status: 302, headers: { location: mode === 'identity' ? MMO_PORTAL.replace('MMO_I', 'OTHER') : MMO_PORTAL } })],
      [MMO_TOC, () => new Response(gzipSync(Buffer.from(JSON.stringify(toc('Medical Mutual Of Ohio', ['https://external.example/f.json.gz'], '2026-10-01')))))],
    ]);
    await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW })('mmoh', p), mode === 'date' ? 'invalid_source' : 'unsupported');
    assert.equal(calls.length, mode === 'date' ? 3 : 2);
  }
});

test('Anthem follows only its official east2 fallback on an explicit east1 status failure', async t => {
  const p = await root(t), calls: string[] = [];
  const routes = new Map<string, () => Response>([
    ['https://www.anthem.com/machine-readable-file/search/', () => new Response('<script src="script.js"></script>')],
    ['https://www.anthem.com/machine-readable-file/search/script.js', () => new Response(EAST1 + EAST2 + ' status.json _anthem_index.json.gz')],
    [EAST1 + 'status.json', () => new Response('no', { status: 403 })],
    [EAST2 + 'anthem/' + DATE + '_anthem_index.json.gz', () => new Response(null, { headers: { 'content-length': '12000000000' } })],
  ]);
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW })('anthem', p), 'blocked_large_toc');
  assert.ok(calls.at(-1)?.startsWith(EAST2));
  assert.equal((await manifest(p)).downloads.at(-1).method, 'HEAD');
});

test('malformed source mappings and false response lengths never yield a usable TOC', async t => {
  const p = await root(t), routes = cignaRoutes(Buffer.from(JSON.stringify({
    ...toc('Cigna Health Life Insurance Company', [rate('wichita-gppo')]),
    reporting_structure: [{ reporting_plans: [], in_network_files: [{ location: rate('wichita-gppo') }] }],
  })));
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('cigna', p), 'invalid_source');
  const p2 = await root(t), short = cignaRoutes();
  short.set(PAGE, () => new Response('short', { headers: { 'content-length': '1000' } }));
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(short, []), now: NOW })('cigna', p2), 'invalid_source');
  assert.equal((await manifest(p2)).downloads[0].complete, false);
});

test('a redirect to a rate path on an otherwise trusted metadata host is never followed', async t => {
  const p = await root(t), calls: string[] = [], routes = cignaRoutes();
  routes.set(PAGE, () => new Response('', { status: 302, headers: { location: rate('wichita-gppo') } }));
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, calls), now: NOW })('cigna', p), 'invalid_source');
  assert.deepEqual(calls, [PAGE]);
});

test('unexpected HTTP content encoding cannot masquerade as the archived original bytes', async t => {
  const p = await root(t), routes = cignaRoutes();
  routes.set(PAGE, () => new Response('decoded body', { headers: { 'content-encoding': 'gzip' } }));
  await rejectedCode(createIssuerDiscoverer({ fetch: fetchRoutes(routes, []), now: NOW })('cigna', p), 'unsupported');
  assert.equal((await manifest(p)).downloads[0].complete, false);
});

test('a stalled cancellation cannot extend the download deadline indefinitely', async t => {
  const p = await root(t);
  const fetcher = (async () => new Response(new ReadableStream({
    pull() { return new Promise(resolve => setTimeout(resolve, 100)); },
    cancel() { return new Promise(() => {}); },
  }))) as typeof fetch;
  await rejectedCode(createIssuerDiscoverer({ fetch: fetcher, now: NOW, limits: { requestMs: 15 } })('cigna', p), 'timeout');
  assert.equal((await manifest(p)).error.code, 'timeout');
});
