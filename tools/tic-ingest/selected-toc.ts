/** Local, disk-backed Anthem TOC projection. No network or rate-file I/O. Node 24. */
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { open, lstat, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { JsonPathTracker, parseJsonTokens, isScalarToken, type JsonToken } from './lib/streaming';

export const SELECTED_TOC_LIMITS = Object.freeze({
  selectedFiles: 400, plansPerFile: 30_000, referencesPerFile: 64,
  structureBytes: 8_000_000, structureNodes: 100_000, scalarBytes: 65_536, depth: 32,
  metadataBytes: 262_144, selectionBytes: 1_000_000, structures: 5_000_000,
  inputBytes: 20_000_000_000, decodedBytes: 512_000_000_000, tempBytes: 2_000_000_000,
  projectionBytes: 100_000_000, projectionGzipBytes: 10_000_000, receiptBytes: 8_000_000,
});
type Limits = { -readonly [K in keyof typeof SELECTED_TOC_LIMITS]: number };
export interface SelectedTocOptions {
  input: string; selected: string; outDir: string; guard?: () => void;
  /** Deterministic fixtures only; CLI always uses the real clock. */
  now?: Date; limits?: Partial<Limits>;
  /** Explicit compact serving scope. Exact type:id identities; never inferred from file location. */
  planIdentities?: string[];
  onProgress?: (stats:{compressedBytes:number;decodedBytes:number;structures:number;elapsedMs:number})=>void;
}
export class SelectedTocError extends Error {
  cleanupPending = false; temporaryPath?: string;
  constructor(public readonly code: 'source' | 'mapping' | 'limit' | 'parse' | 'storage', message: string) {
    super(message); this.name = 'SelectedTocError';
  }
}
function fail(code: SelectedTocError['code'], message: string): never { throw new SelectedTocError(code, message); }
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
class RawNumber { constructor(readonly value: string) {} }
type Json = string | number | boolean | null | RawNumber | Json[] | { [key: string]: Json };
function canonical(value: Json): string {
  if (value instanceof RawNumber) return value.value;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function obj(value: Json | undefined): { [key: string]: Json } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof RawNumber) return fail('mapping', 'Expected a source object');
  return value;
}
function text(value: Json | undefined, field = 'source value'): string {
  if (typeof value !== 'string' || !value.trim()) return fail('mapping', 'Required '+field+' string is missing or malformed');
  return value;
}
const SIGNATURE_KEYS = new Set(['signature', 'expires', 'policy', 'key-pair-id', 'x-amz-algorithm',
  'x-amz-credential', 'x-amz-date', 'x-amz-expires', 'x-amz-signedheaders', 'x-amz-signature', 'x-amz-security-token']);
function identity(value: string, allowPath = false): { key: string; pathKey: string; pathOnly: boolean } {
  const pathOnly = allowPath && value.startsWith('/') && !value.startsWith('//');
  let u: URL;
  try { u = new URL(value, pathOnly ? 'https://selected-path.invalid' : undefined); }
  catch { return fail('mapping', 'Invalid source reference or selected URL/path'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) fail('mapping', 'References must be HTTPS without credentials, explicit nondefault ports or fragments');
  // Preserve unknown query text and ordering. Only known authentication parameters
  // and empty separators are removed; no month, shard, host, or semantic query rewriting.
  const parts = u.search.slice(1).split('&').filter(part => {
    if (!part) return false;
    let key: string;
    try { key = decodeURIComponent(part.split('=', 1)[0].replace(/\+/g, ' ')).toLowerCase(); }
    catch { return fail('mapping', 'Invalid reference query encoding'); }
    return !SIGNATURE_KEYS.has(key);
  });
  const pathKey = u.pathname + (parts.length ? '?' + parts.join('&') : '');
  return { key: pathOnly ? 'path:' + pathKey : 'url:' + u.origin + pathKey, pathKey, pathOnly };
}
class Collector {
  value: Json = null; done = false; bytes = 0; nodes = 0;
  private stack: Array<{ value: Json[] | { [key: string]: Json }; key?: string }> = [];
  constructor(private byteCap: number, private nodeCap: number) {}
  push(token: JsonToken) {
    this.nodes++;
    this.bytes += ['keyValue', 'stringValue'].includes(token.name) ? Buffer.byteLength(JSON.stringify(token.value)) + 2 :
      token.name === 'numberValue' ? String(token.value).length + 1 : 6;
    if (this.bytes > this.byteCap || this.nodes > this.nodeCap) fail('limit', 'Collected structure or metadata exceeds its explicit cap');
    const attach = (value: Json) => {
      const p = this.stack.at(-1);
      if (!p) this.value = value;
      else if (Array.isArray(p.value)) p.value.push(value);
      else { if (p.key === undefined) fail('parse', 'Missing object key'); p.value[p.key] = value; p.key = undefined; }
    };
    if (token.name === 'keyValue') { this.stack.at(-1)!.key = String(token.value); return; }
    if (token.name === 'startObject' || token.name === 'startArray') {
      const value = token.name === 'startArray' ? [] : Object.create(null);
      attach(value); this.stack.push({ value }); return;
    }
    if (token.name === 'endObject' || token.name === 'endArray') {
      this.stack.pop(); if (!this.stack.length) this.done = true; return;
    }
    if (isScalarToken(token)) {
      attach(token.name === 'numberValue' ? new RawNumber(String(token.value)) :
        token.name === 'nullValue' ? null : token.name === 'trueValue' ? true :
        token.name === 'falseValue' ? false : String(token.value));
      if (!this.stack.length) this.done = true;
    }
  }
}
type Selection = {
  id: number; requested: string; key: string; pathKey: string; pathOnly: boolean;
  matchedKey?: string; plans: number; references: number;
};
export interface SelectedTocResult {
  directory: string; receiptPath: string; parentSha256: string; projected: number; unresolved: number;
  scope: 'selected-file-only; whole-plan and national completeness unverified';
}
const SCOPE = 'selected-file-only; whole-plan and national completeness unverified' as const;

export async function buildSelectedToc(options: SelectedTocOptions): Promise<SelectedTocResult> {
  if (Number(process.versions.node.split('.')[0]) !== 24) fail('source', 'Run this tool with the repository Node 24 runtime');
  const limits: Limits = { ...SELECTED_TOC_LIMITS, ...options.limits };
  for (const k of Object.keys(limits) as Array<keyof Limits>) {
    if (!Number.isSafeInteger(limits[k]) || limits[k] <= 0 || limits[k] > SELECTED_TOC_LIMITS[k]) fail('limit', 'Limits must be positive integers at or below the tested maxima');
  }
  const startedAt=Date.now();let lastProgress=startedAt;
  const identityCache=new Map<string,ReturnType<typeof identity>>();
  const referenceIdentity=(value:string)=>{let parsed=identityCache.get(value);if(!parsed){parsed=identity(value);if(identityCache.size<20000)identityCache.set(value,parsed);}return parsed;};
  const guard = () => { try { options.guard?.(); } catch { fail('storage', 'Storage identity guard failed'); } };
  const planIdentities=options.planIdentities ? new Set(options.planIdentities) : undefined;
  if(planIdentities && (!planIdentities.size || planIdentities.size>10000 || [...planIdentities].some(p=>!/^(ein|hios):[a-zA-Z0-9-]+$/.test(p))))fail('limit','Invalid explicit plan identity scope');
  const outRoot = resolve(options.outDir), inputPath = resolve(options.input), selectedPath = resolve(options.selected);
  guard();
  let root;
  try { root = await lstat(outRoot); } catch { return fail('storage', 'Output archive root must already exist'); }
  if (!root.isDirectory() || root.isSymbolicLink()) fail('storage', 'Output archive root must be an existing directory');
  const selectionHandle = await open(selectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let selectionBytes: Buffer;
  try {
    const chunks: Buffer[] = []; let count = 0;
    for await (const chunk of selectionHandle.createReadStream({ autoClose: false, highWaterMark: 16_384 })) {
      guard(); const b = chunk as Buffer; count += b.length;
      if (count > limits.selectionBytes) fail('limit', 'Selection JSON exceeds its byte cap');
      chunks.push(b);
    }
    selectionBytes = Buffer.concat(chunks);
  } finally { await selectionHandle.close(); }
  let rawSelections: unknown;
  try { rawSelections = JSON.parse(selectionBytes.toString()); } catch { return fail('source', 'Invalid selection JSON'); }
  if (!Array.isArray(rawSelections) || !rawSelections.length || rawSelections.length > limits.selectedFiles) fail('limit', 'Selection must contain 1 to 400 URL/path strings within the configured cap');
  const byKey = new Map<string, Selection>(), byPath = new Map<string, Selection>();
  const selections: Selection[] = rawSelections.map((value, id) => {
    if (typeof value !== 'string') return fail('source', 'Each selection must be a URL/path string');
    if (Buffer.byteLength(value) > limits.scalarBytes) return fail('limit', 'Selected URL/path exceeds the scalar cap');
    const parsed = identity(value, true);
    if (byKey.has(parsed.key)) fail('source', 'Duplicate selected identity after signature normalization');
    const selection = { ...parsed, id, requested: value, plans: 0, references: 0 };
    byKey.set(parsed.key, selection); if (parsed.pathOnly) byPath.set(parsed.pathKey, selection);
    return selection;
  });
  guard();
  const handle = await open(inputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let stage: string | undefined, db: DatabaseSync | undefined;
  let parsePipe: Promise<void> | undefined;
  const streams: Array<{ destroy: () => unknown }> = [];
  let committed = false;
  let semanticError: SelectedTocError | undefined;
  let originalTokenError:unknown;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limits.inputBytes)) fail('limit', 'Input must be a bounded complete local regular gzip file');
    const magic = Buffer.alloc(2); await handle.read(magic, 0, 2, 0);
    if (magic[0] !== 0x1f || magic[1] !== 0x8b) fail('source', 'Input must be the complete archived gzip');
    guard(); stage = await mkdtemp(join(outRoot, '.selected-toc-'));
    const dbPath = join(stage, 'mappings.sqlite');
    guard(); const scratch = await open(dbPath, 'wx', 0o600); await scratch.close();
    guard(); db = new DatabaseSync(dbPath, { allowExtension: false });
    db.exec('PRAGMA page_size=4096; PRAGMA cache_size=-8192; PRAGMA mmap_size=0; PRAGMA temp_store=FILE; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
    db.exec('PRAGMA max_page_count=' + Math.floor(limits.tempBytes / 4096));
    db.exec('CREATE TABLE plans(s INTEGER NOT NULL,j TEXT NOT NULL,PRIMARY KEY(s,j)) WITHOUT ROWID; CREATE TABLE refs(s INTEGER NOT NULL,j TEXT NOT NULL,PRIMARY KEY(s,j)) WITHOUT ROWID; BEGIN');
    const insertPlan = db.prepare('INSERT OR IGNORE INTO plans VALUES(?,?)'), insertRef = db.prepare('INSERT OR IGNORE INTO refs VALUES(?,?)');
    const pageCount = db.prepare('PRAGMA page_count');
    let dbBytes = 0, outputBytes = 0, peakTempBytes = 0;
    const budget = () => {
      dbBytes = Number(pageCount.get()!.page_count) * 4096;
      peakTempBytes = Math.max(peakTempBytes, dbBytes + outputBytes);
      if (dbBytes + outputBytes > limits.tempBytes) fail('limit', 'Temporary disk budget exceeded');
    };
    const metadata: { [key: string]: Json } = Object.create(null);
    const tracker = new JsonPathTracker();
    const frames: Array<{ kind: string; keys?: Set<string> }> = [];
    let rootSeen = false, rootClosed = false, structuresSeen = 0, structuresArray = false;
    let scalarBytes = 0, metadataBytes = 0, maxStructureBytes = 0, maxStructureNodes = 0;
    let active: { collector: Collector; role: 'structure' | 'metadata'; key?: string } | undefined;
    function addMetadata(key: string, value: Json) {
      metadataBytes += Buffer.byteLength(JSON.stringify(key)) + Buffer.byteLength(canonical(value)) + 2;
      if (metadataBytes > limits.metadataBytes) fail('limit', 'Root metadata exceeds its cap');
      metadata[key] = value;
    }
    function storeStructure(value: Json) {
      guard();
      const structure = obj(value), plans = structure.reporting_plans;
      if (!Array.isArray(plans) || !plans.length) fail('mapping', 'Reporting structure lacks reporting plans');
      for (const value of plans) {
        const p = obj(value);
        if (p.plan_name !== undefined && typeof p.plan_name !== 'string') fail('mapping', 'Malformed optional plan name');
        text(p.plan_id, 'p.plan_id');
        if (!['ein', 'hios'].includes(text(p.plan_id_type, 'p.plan_id_type').toLowerCase())) fail('mapping', 'Invalid plan identifier type');
        if (p.plan_market_type !== undefined) text(p.plan_market_type, 'p.plan_market_type');
      }
      const files = structure.in_network_files === undefined ? [] : structure.in_network_files;
      if (!Array.isArray(files)) fail('mapping', 'Malformed in-network reference array');
      if (structure.allowed_amount_file !== undefined) {
        const allowed = obj(structure.allowed_amount_file); referenceIdentity(text(allowed.location, 'allowed.location'));
        if (allowed.description !== undefined) text(allowed.description, 'allowed.description');
      }
      if (!files.length && structure.allowed_amount_file === undefined) fail('mapping', 'Reporting structure contains no file references');
      const matched = new Set<number>();
      for (const value of files) {
        const file = obj(value), location = text(file.location, 'file.location'), actual = referenceIdentity(location);
        if (file.description !== undefined) text(file.description, 'file.description');
        const exact = byKey.get(actual.key), path = byPath.get(actual.pathKey);
        if (exact && path && exact !== path) fail('mapping', 'Overlapping URL/path selections identify one source twice');
        const selected = exact ?? path; if (!selected) continue;
        if (selected.matchedKey && selected.matchedKey !== actual.key) fail('mapping', 'Selected path is ambiguous across source hosts');
        selected.matchedKey = actual.key;
        if (Number(insertRef.run(selected.id, canonical(value)).changes)) selected.references++;
        if (selected.references > limits.referencesPerFile) fail('limit', 'Source reference variants exceed the per-file cap');
        matched.add(selected.id);
      }
      const scopedPlans=planIdentities ? plans.filter(p=>{const v=obj(p);return planIdentities.has(text(v.plan_id_type).toLowerCase()+':'+text(v.plan_id));}) : plans;
      const planJson = matched.size ? scopedPlans.map(canonical) : [];
      for (const id of matched) {
        const selected = selections[id];
        for (const plan of planJson) {
          if (Number(insertPlan.run(id, plan).changes)) selected.plans++;
          if (selected.plans > limits.plansPerFile) fail('limit', 'Selected source exceeds the 30000-plan mapping cap');
        }
      }
      if (matched.size) budget();
      if (structuresSeen % 1000 === 0) { guard(); db!.exec('COMMIT; BEGIN'); }
    }
    const onToken = (token: JsonToken) => {
      if (['startKey', 'startString', 'startNumber'].includes(token.name)) scalarBytes = 0;
      if (token.name === 'stringChunk' || token.name === 'numberChunk') {
        scalarBytes += Buffer.byteLength(String(token.value));
        if (scalarBytes > limits.scalarBytes) fail('limit', 'Scalar exceeds its streaming byte cap');
      }
      if (!['startObject', 'startArray', 'endObject', 'endArray', 'keyValue'].includes(token.name) && !isScalarToken(token)) return;
      const starts = token.name === 'startObject' || token.name === 'startArray', ends = token.name === 'endObject' || token.name === 'endArray';
      const path = starts ? tracker.pathForStart() : isScalarToken(token) ? tracker.pathForValue() : [];
      if (!rootSeen) {
        if (token.name !== 'startObject') fail('source', 'TOC root must be an object');
        rootSeen = true;
      } else if (rootClosed) fail('parse', 'Trailing JSON value after TOC root');
      if (token.name === 'keyValue') {
        const key = String(token.value), frame = frames.at(-1);
        if (!frame?.keys || frame.keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('source', 'Duplicate or unsafe object key');
        frame.keys.add(key);
        if (frames.length === 1 && frame.keys.size > 256) fail('limit', 'Too many root metadata keys');
      }
      if (path[0] === 'reporting_structure' && path.length === 1 && starts) {
        if (token.name !== 'startArray' || structuresArray) fail('mapping', 'reporting_structure must be one array');
        structuresArray = true;
      }
      if (path[0] === 'reporting_structure' && path.length === 1 && isScalarToken(token)) fail('mapping', 'reporting_structure must be an array');
      if (!active && path.length === 2 && path[0] === 'reporting_structure') {
        if (token.name !== 'startObject') fail('mapping', 'Reporting structure must be an object');
        if (++structuresSeen > limits.structures) fail('limit', 'Reporting structure count exceeds its cap');
        active = { collector: new Collector(limits.structureBytes, limits.structureNodes), role: 'structure' };
      } else if (!active && path.length === 1 && path[0] !== 'reporting_structure' && (starts || isScalarToken(token))) {
        active = { collector: new Collector(limits.metadataBytes, limits.structureNodes), role: 'metadata', key: path[0] };
      }
      if (active) {
        active.collector.push(token);
        if (active.collector.done) {
          const completed = active; active = undefined;
          if (completed.role === 'metadata') addMetadata(completed.key!, completed.collector.value);
          else {
            maxStructureBytes = Math.max(maxStructureBytes, completed.collector.bytes);
            maxStructureNodes = Math.max(maxStructureNodes, completed.collector.nodes);
            storeStructure(completed.collector.value);
          }
        }
      }
      if (starts) {
        if (frames.length >= limits.depth) fail('limit', 'JSON nesting exceeds its cap');
        tracker.start(token.name === 'startObject' ? 'object' : 'array');
        frames.push({ kind: token.name, keys: token.name === 'startObject' ? new Set() : undefined });
      } else if (ends) {
        tracker.end(); frames.pop(); if (!frames.length) rootClosed = true;
      } else if (token.name === 'keyValue') tracker.key(token.value);
      else tracker.value();
    };
    let compressedBytes = 0, decodedBytes = 0;
    const parentHash = createHash('sha256');
    const raw = handle.createReadStream({ autoClose: false, start: 0, highWaterMark: 65_536 });
    const hashInput = new Transform({ transform(chunk: Buffer, _, done) {
      try { guard(); compressedBytes += chunk.length; if (compressedBytes > limits.inputBytes) fail('limit', 'Compressed input exceeds its cap'); parentHash.update(chunk);
        if(Date.now()-lastProgress>=30000){lastProgress=Date.now();options.onProgress?.({compressedBytes,decodedBytes,structures:structuresSeen,elapsedMs:Date.now()-startedAt});}
        done(null, chunk); }
      catch (error) { if(error instanceof SelectedTocError)semanticError??=error; done(error as Error); }
    } });
    const unzip = createGunzip();
    const utf8 = new TextDecoder('utf-8', { fatal: true });
    const decoded = new Transform({ transform(chunk: Buffer, _, done) {
      try { guard(); utf8.decode(chunk, { stream: true }); decodedBytes += chunk.length; if (decodedBytes > limits.decodedBytes) fail('limit', 'Decoded input exceeds its cap'); done(null, chunk); }
      catch (error) { if(error instanceof SelectedTocError)semanticError??=error; done(error as Error); }
    }, flush(done) {
      try { utf8.decode(); done(); } catch (error) { if(error instanceof SelectedTocError)semanticError??=error; done(error as Error); }
    } });
    streams.push(raw, hashInput, unzip, decoded);
    parsePipe = pipeline(raw, hashInput, unzip, decoded);
    try {
      const outcomes=await Promise.allSettled([parsePipe,parseJsonTokens(decoded,(token)=>{try{onToken(token);}catch(error){originalTokenError??=error;if(error instanceof SelectedTocError)semanticError??=error;throw error;}})]);
      const failed=outcomes.filter((x): x is PromiseRejectedResult=>x.status==='rejected');
      if(failed.length)throw (failed.find(x=>x.reason instanceof SelectedTocError)??failed[0]).reason;
    }
    catch (error) {
      for (const stream of streams) stream.destroy();
      await parsePipe.catch(() => {}); throw error;
    }
    if (!rootClosed || frames.length || active || !structuresArray || !structuresSeen) fail('parse', 'Full TOC JSON EOF was not validated');
    if (compressedBytes !== Number(before.size)) fail('source', 'Parent archive was not read completely');
    const parentSha256 = parentHash.digest('hex');
    const checkParent = async () => {
      guard();
      const after = await handle.stat({ bigint: true }), named = await lstat(inputPath, { bigint: true });
      if ([after, named].some(s => s.dev !== before.dev || s.ino !== before.ino || s.size !== before.size || s.mtimeNs !== before.mtimeNs || s.ctimeNs !== before.ctimeNs)) fail('source', 'Parent archive changed during projection');
    };
    await checkParent();
    if (metadata.reporting_entity_name !== 'Anthem Inc' || !['health insurance issuer', 'Health Insurance Issuer'].includes(text(metadata.reporting_entity_type)) ||
        !/^2\.\d+\.\d+$/.test(text(metadata.version))) fail('source', 'Unexpected Anthem source metadata');
    const sourceDate = text(metadata.last_updated_on), dateMs = Date.parse(sourceDate), now = options.now ?? new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== sourceDate ||
        dateMs > now.getTime() || now.getTime() - dateMs > 60 * 86_400_000) fail('source', 'Parent source date is invalid, stale or future-dated');
    guard(); db.exec('COMMIT'); budget();
    const readPlans = db.prepare('SELECT j FROM plans WHERE s=? ORDER BY j'), readRefs = db.prepare('SELECT j FROM refs WHERE s=? ORDER BY j');
    const projections: Array<Record<string, Json>> = [];
    for (const selected of [...selections].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) {
      if (!selected.matchedKey || (planIdentities && !selected.plans)) continue;
      if (!selected.plans || !selected.references) fail('mapping', 'Matched source has no complete plan mapping');
      const file = sha(selected.key) + '.json.gz', path = join(stage, file), gzipHash = createHash('sha256'), decodedHash = createHash('sha256');
      let projectionBytes = 0, gzipBytes = 0;
      async function* chunks() {
        yield '{';
        for (const k of Object.keys(metadata).sort()) yield JSON.stringify(k) + ':' + canonical(metadata[k]) + ',';
        yield '"reporting_structure":[{"in_network_files":[';
        let first = true;
        for (const row of readRefs.iterate(selected.id)) { yield (first ? '' : ',') + String(row.j); first = false; }
        yield '],"reporting_plans":['; first = true;
        for (const row of readPlans.iterate(selected.id)) { yield (first ? '' : ',') + String(row.j); first = false; }
        yield ']}]}\n';
      }
      const meter = new Transform({ transform(chunk: Buffer, _, done) {
        try { guard(); projectionBytes += chunk.length; if (projectionBytes > limits.projectionBytes) fail('limit', 'Projection decoded byte cap exceeded'); decodedHash.update(chunk); done(null, chunk); }
        catch (error) { if(error instanceof SelectedTocError)semanticError??=error; done(error as Error); }
      } });
      const compressed = new Transform({ transform(chunk: Buffer, _, done) {
        try {
          guard(); gzipBytes += chunk.length; outputBytes += chunk.length;
          if (gzipBytes > limits.projectionGzipBytes || dbBytes + outputBytes > limits.tempBytes) fail('limit', 'Projection compressed or temporary disk cap exceeded');
          peakTempBytes = Math.max(peakTempBytes, dbBytes + outputBytes); gzipHash.update(chunk); done(null, chunk);
        } catch (error) { if(error instanceof SelectedTocError)semanticError??=error; done(error as Error); }
      } });
      guard();
      await pipeline(Readable.from(chunks(), { objectMode: false }), meter, createGzip({ level: 9 }), compressed, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
      guard(); const output = await open(path, 'r+'); try { await output.sync(); } finally { await output.close(); }
      const firstReference = JSON.parse(String(readRefs.get(selected.id)!.j));
      projections.push({
        selected: selected.requested, identity: selected.key, sourceUrl: firstReference.location, file,
        parentSha256, plans: selected.plans, references: selected.references,
        sha256: gzipHash.digest('hex'), decodedSha256: decodedHash.digest('hex'), bytes: gzipBytes, decodedBytes: projectionBytes, scope: SCOPE,
      });
    }
    guard(); db.close(); db = undefined; await rm(dbPath);
    const unresolved = selections.filter(s => !s.matchedKey || (planIdentities && !s.plans)).map(s => ({ selected: s.requested, identity: s.key, reason: s.matchedKey ? 'No exact plan mapping within the explicit employer scope at validated EOF' : 'No exact identity encountered at validated parent EOF; replacement or retirement unknown' }));
    const receipt: Json = {
      version: 1, scope: SCOPE, status: unresolved.length ? 'partial' : 'selected-projections-complete',
      parent: { sha256: parentSha256, compressedBytes, decodedBytes, metadata, sourceDate, validatedJsonEof: true },
      selection: { sha256: sha(selectionBytes), count: selections.length },
      planSelection: planIdentities ? {identities:[...planIdentities].sort(),count:planIdentities.size,scope:'explicit employer identities only; other employers unverified'} : null, projections, unresolved,
      observedAt: now.toISOString(), limits, stats: { structuresSeen, maxStructureBytes, maxStructureNodes, peakTempBytes, peakRssMiB: process.resourceUsage().maxRSS / 1024 },
    };
    const receiptBytes = Buffer.from(canonical(receipt) + '\n');
    if (receiptBytes.length > limits.receiptBytes || outputBytes + receiptBytes.length > limits.tempBytes) fail('limit', 'Receipt exceeds output or temporary disk cap');
    guard(); await writeFile(join(stage, 'receipt.json'), receiptBytes, { flag: 'wx', mode: 0o600 });
    guard(); const receiptHandle = await open(join(stage, 'receipt.json'), 'r+');
    try { await receiptHandle.sync(); } finally { await receiptHandle.close(); }
    await checkParent();
    const directory = join(outRoot, basename(stage).replace('.selected-toc-', 'selected-toc-'));
    guard();
    try { await lstat(directory); fail('storage', 'Projection destination already exists'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    guard(); await rename(stage, directory); committed = true;
    return { directory, receiptPath: join(directory, 'receipt.json'), parentSha256, projected: projections.length, unresolved: unresolved.length, scope: SCOPE };
  } catch (error) {
    error=semanticError??originalTokenError??error;
    const safe = semanticError ?? (error instanceof SelectedTocError ? error : new SelectedTocError(
      String((error as NodeJS.ErrnoException).code).includes('SQLITE') ? 'limit' : 'parse',
      'Selected TOC build failed; no projection directory was committed'));
    if (safe !== error) Object.defineProperty(safe, 'cause', { value: error });
    if (db) { try { db.close(); } catch {} db = undefined; }
    for (const stream of streams) stream.destroy();
    await parsePipe?.catch(() => {});
    if (stage && !committed) {
      try { guard(); await rm(stage, { recursive: true, force: true }); }
      catch { safe.cleanupPending = true; safe.temporaryPath = stage; }
    }
    throw safe;
  } finally { await handle.close(); }
}

async function main() {
  const args = process.argv.slice(2), get = (name: string) => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1]; };
  const input = get('in'), selected = get('selected'), outDir = get('out-dir');
  if (!input || !selected || !outDir) fail('source', 'Usage: selected-toc.ts --in <complete-local.json.gz> --selected <urls.json> --out-dir <existing-root>');
  const result = await buildSelectedToc({ input, selected, outDir });
  console.log(JSON.stringify(result)); // Counts/hashes/paths only; never print issuer signed URLs.
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    const safe = error instanceof SelectedTocError ? error : new SelectedTocError('parse', 'Selected TOC build failed');
    console.error(JSON.stringify({ code: safe.code, message: safe.message, cleanupPending: safe.cleanupPending, temporaryPath: safe.temporaryPath }));
    process.exitCode = 1;
  });
}
