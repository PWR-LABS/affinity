import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ANTHEM_SELECTION_EINS, AnthemSelectionError, createAnthemSelectionDiscoverer } from '../scripts/lib/anthem-selection';

const EAST1 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/';
const EAST2 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east2.s3.us-east-2.amazonaws.com/';
const PAGE = 'https://www.anthem.com/machine-readable-file/search/';
const TOC = EAST1 + 'anthem/2026-11-01_anthem_index.json.gz';
const NOW = () => new Date('2026-11-04T22:00:00Z');
const candidate = (id: string, signature = 'private-test-link') => 'https://anthembcbsoh.mrf.bcbs.com/2026-11_' + id + '_in-network-rates.json.gz?&Expires=1797861651&Signature=' + signature;
function document(i: number, extra: Record<string, unknown> = {}) {
  return {
    lastupdated: '2026-11-01',
    'In-Network Negotiated Rates Files': [{ url: candidate('shared', 'sig-' + i), displayname: 'Shared' }, { url: candidate(String(i)), displayname: 'File ' + i }],
    'Out-of-Network Allowed Amounts Files': [{ url: 'https://excluded.example/allowed.json.gz' }],
    'Blue Cross Blue Shield Association Out-of-Area Rates Files': [{ url: 'https://excluded.example/out-of-area.json.gz' }],
    ...extra,
  };
}
function routes() {
  const map = new Map<string, () => Response>([
    [PAGE, () => new Response('<script src="script.js"></script>')],
    [PAGE + 'script.js', () => new Response(EAST1 + EAST2 + ' status.json _anthem_index.json.gz')],
    [EAST1 + 'status.json', () => new Response('{"status":"true"}')],
    [TOC, () => new Response(null, { headers: { 'content-length': '11517571151' } })],
  ]);
  ANTHEM_SELECTION_EINS.forEach((ein,i) => map.set(EAST1 + 'anthem/' + ein + '.json', () => Response.json(document(i))));
  return map;
}
function transport(map: Map<string, () => Response>, calls: Array<{url: string; method: string}>) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input); calls.push({ url: u, method: init?.method ?? 'GET' });
    const route = map.get(u); if (!route) throw new Error('Unexpected URL; a rate download must never occur');
    return route();
  }) as typeof fetch;
}
async function root(t: {after: (fn: () => Promise<void>) => void}) {
  const p = await mkdtemp(join(tmpdir(), 'affinity-anthem-selection-')); t.after(() => rm(p,{recursive:true,force:true})); return p;
}
async function failedReceipt(p: string) { const [run] = await readdir(p); return JSON.parse(await readFile(join(p,run,'receipt.json'),'utf8')); }
async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, e => e instanceof AnthemSelectionError && e.code === code && !e.message.includes('Signature='));
}

test('four official inventories become a provenance-bound URL array without invented plans or rate requests', async t => {
  const p = await root(t), calls: Array<{url:string;method:string}> = [], map = routes(); let guards = 0;
  const r = await createAnthemSelectionDiscoverer({ fetch: transport(map,calls), now:NOW })(p,{guard(){guards++;}});
  const selections = JSON.parse(await readFile(r.selectionPath,'utf8')), receipt = JSON.parse(await readFile(r.receiptPath,'utf8'));
  assert.equal(r.selectedCount,5); assert.equal(r.sourceMonth,'2026-11'); assert.deepEqual(r.sourceDates,['2026-11-01']);
  assert.equal(r.selectedPath,r.selectionPath);assert.equal(r.tocUrl,TOC);assert.equal(r.sourceDate,'2026-11-01');assert.equal(r.tocSourceDate,null);
  assert.deepEqual(r.unresolvedEins,[]); assert.match(r.scope,/canonical reporting_plans require the complete validated TOC/);
  assert.ok(selections.every((x:unknown) => typeof x === 'string'));
  assert.ok(selections.includes(candidate('shared','sig-0')));
  assert.ok(!JSON.stringify(receipt).includes('private-test-link'));
  assert.equal(receipt.plansSynthesized,false); assert.equal(receipt.canonicalMappingsValidated,false);
  assert.equal(receipt.documents.length,4); assert.equal(receipt.resolver.sourceDate,null);
  assert.equal(receipt.selection.sha256,createHash('sha256').update(await readFile(r.selectionPath)).digest('hex'));
  for (const doc of receipt.documents) {
    const bytes = await readFile(join(r.directory,doc.file));
    assert.equal(doc.sha256,createHash('sha256').update(bytes).digest('hex')); assert.equal(doc.sourceDate,'2026-11-01');
    assert.equal(doc.categories['Out-of-Network Allowed Amounts Files'],1);
  }
  const resolver = await readFile(join(r.directory,receipt.resolver.file));
  assert.equal(receipt.resolver.sha256,createHash('sha256').update(resolver).digest('hex'));
  assert.equal(calls.length,8); assert.equal(calls.find(c=>c.url===TOC)?.method,'HEAD');
  assert.ok(calls.every(c=>!c.url.includes('_in-network-rates')));
  assert.ok(guards>15); assert.equal((await stat(r.selectionPath)).mode & 0o777,0o600);
});

test('semantic queries remain distinct while known signature churn deduplicates', async t => {
  const p=await root(t),map=routes();
  ANTHEM_SELECTION_EINS.forEach((ein,i)=>map.set(EAST1+'anthem/'+ein+'.json',()=>Response.json(document(i,{
    'In-Network Negotiated Rates Files':[{url:candidate('same','sig-'+i)+'&network=one'},{url:candidate('same','other-'+i)+'&network=two'}],
  }))));
  const r=await createAnthemSelectionDiscoverer({fetch:transport(map,[]),now:NOW})(p);
  assert.equal(r.selectedCount,2);
  const selected=JSON.parse(await readFile(r.selectionPath,'utf8'));
  assert.ok(selected.some((u:string)=>u.includes('network=one')));assert.ok(selected.some((u:string)=>u.includes('network=two')));
});

test('an empty current employer inventory stays explicitly unresolved rather than implying retirement',async t=>{
  const p=await root(t),map=routes();map.set(EAST1+'anthem/'+ANTHEM_SELECTION_EINS[0]+'.json',()=>Response.json(document(0,{'In-Network Negotiated Rates Files':[]})));
  const r=await createAnthemSelectionDiscoverer({fetch:transport(map,[]),now:NOW})(p);
  assert.deepEqual(r.unresolvedEins,[ANTHEM_SELECTION_EINS[0]]);
  assert.equal(JSON.parse(await readFile(r.receiptPath,'utf8')).status,'partial');
});

test('stale/future/undated metadata, new hosts and malformed URL items fail with protected source evidence',async t=>{
  for(const extra of [
    {lastupdated:'2026-10-01'},{lastupdated:'2026-11-05'},{lastupdated:null},
    {'In-Network Negotiated Rates Files':[{url:'https://unreviewed.example/file.json.gz'}]},
    {'In-Network Negotiated Rates Files':[{url:123}]},
  ]){
    const p=await root(t),map=routes();map.set(EAST1+'anthem/'+ANTHEM_SELECTION_EINS[0]+'.json',()=>Response.json(document(0,extra)));
    await rejects(createAnthemSelectionDiscoverer({fetch:transport(map,[]),now:NOW})(p),'source');
    const receipt=await failedReceipt(p);assert.equal(receipt.status,'failed');assert.equal(receipt.documents.length,1);
    assert.equal(receipt.selection,undefined);
  }
});

test('advertised/streamed sizes and selected-file cap fail without silently dropping candidates',async t=>{
  for(const mode of ['header','body','candidates','selection']){
    const p=await root(t),map=routes();
    if(mode==='header'||mode==='body')map.set(EAST1+'anthem/'+ANTHEM_SELECTION_EINS[0]+'.json',()=>new Response(new Uint8Array(101),mode==='header'?{headers:{'content-length':'1000001'}}:undefined));
    await rejects(createAnthemSelectionDiscoverer({fetch:transport(map,[]),now:NOW,limits:mode==='body'?{documentBytes:100}:mode==='candidates'?{candidates:2}:mode==='selection'?{selectionBytes:100}:{}})(p),'limit');
    assert.equal((await failedReceipt(p)).selection,undefined);
  }
});

test('HTTP failure/redirect never becomes a partial successful selection or an extra network request',async t=>{
  for(const status of [404,302]){
    const p=await root(t),map=routes(),calls:Array<{url:string;method:string}>=[];
    map.set(EAST1+'anthem/'+ANTHEM_SELECTION_EINS[0]+'.json',()=>new Response('Unavailable',{status,headers:{location:'https://excluded.example/redirect'}}));
    await rejects(createAnthemSelectionDiscoverer({fetch:transport(map,calls),now:NOW})(p),'http');
    assert.equal(calls.length,5);assert.equal((await failedReceipt(p)).status,'failed');
  }
});

test('metadata request stalls are timed out without logging source URLs',async t=>{
  const p=await root(t),map=routes(),normal=transport(map,[]);
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    if(String(input).endsWith('/'+ANTHEM_SELECTION_EINS[0]+'.json'))return await new Promise<Response>(resolve=>setTimeout(()=>resolve(Response.json(document(0))),150));
    return normal(input,init);
  }) as typeof fetch;
  await rejects(createAnthemSelectionDiscoverer({fetch:fetcher,now:NOW,limits:{requestMs:50}})(p),'timeout');
  assert.equal((await failedReceipt(p)).selection,undefined);
});

test('storage guards prevent phantom roots and stop streaming writes after device loss',async t=>{
  const p=await root(t),missing=join(p,'missing','archive');
  await rejects(createAnthemSelectionDiscoverer({now:NOW})(missing),'storage');assert.deepEqual(await readdir(p),[]);
  const map=routes(),normal=transport(map,[]);let mounted=true;
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{
    if(String(input).endsWith('/'+ANTHEM_SELECTION_EINS[0]+'.json'))return new Response(new ReadableStream({
      pull(controller){mounted=false;controller.enqueue(Buffer.from('partial'));controller.close();},
    }));
    return normal(input,init);
  }) as typeof fetch;
  await assert.rejects(createAnthemSelectionDiscoverer({fetch:fetcher,now:NOW})(p,{guard(){if(!mounted)throw new Error('Detached');}}),
    e=>e instanceof AnthemSelectionError&&e.code==='storage'&&!e.receiptWritten);
  assert.ok((await readdir(p)).every(name=>name.startsWith('.anthem-selection-')));
});
