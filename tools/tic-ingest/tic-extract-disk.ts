/** Strict local TiC extraction. Complete groups, references and NPI arrays stay on disk.
 * scratchRoot and the output parent must already exist on the same filesystem.
 * The caller's guard owns mount authorization; device/inode checks also prevent
 * writing or cleaning through a replaced scratch root. Inaccessible cleanup is
 * explicit on an error (cleanupPending/scratchPath) or successful summary.disk.
 */
import { constants, lstatSync, realpathSync, readFileSync,type BigIntStats } from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { open, lstat, realpath, mkdtemp, rm, rename, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { openZipJson, type ZipJsonReadable } from './lib/zip-json';
import type { ExtractSummary } from './tic-extract';

const require = createRequire(import.meta.url);
const extractorRevision=createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(fileURLToPath(new URL('./lib/zip-json.ts',import.meta.url)))).update(process.version).digest('hex');
const { parser } = require('stream-json');
const SCALAR_BYTES = 65_536, DEPTH = 64, KEY_BYTES = 65_536;
export interface DiskExtractProgress {
  phase: 'parse' | 'resolve' | 'output'; decodedBytes: number; scratchBytes: number;
  groups: number; references: number; pairs: number; elapsedMs: number;
}
export interface DiskExtractOptions {
  input: string; out: string; sourceUrl: string; scratchRoot: string; guard?: () => void;
  maxPairs?: number; maxMs?: number; maxScratchBytes?: number; maxDecodedBytes?: number;
  onProgress?: (progress: DiskExtractProgress) => void;
}
export type DiskExtractSummary = ExtractSummary & { disk: {
  decodedBytes: number; peakScratchBytes: number; groups: number; references: number;
  cleanupPending?: boolean; scratchPath?: string;
}; validation:{policy:'tic-membership-v1-strict';extractorRevision:string;jsonEof:true;archiveIntegrity:true;referenceClosure:true;sourceStable:true;limits:{maxPairs:number;maxMs:number;maxScratchBytes:number;maxDecodedBytes:number}} };
type Token = { name: string; value?: unknown };
type Frame = {
  kind: 'object' | 'array'; path: string[]; key?: string; keys?: Set<string>; keyBytes: number;
  ref?: number; group?: number; identifier?: string; hasGroups?: boolean;
  tinType?: string; tinValue?: string; hasNpis?: boolean; inline?: boolean;
  scalarRelevant: boolean;
};
const equal = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const referencePath = ['provider_references', '*'];
const inlineGroupPath = ['in_network', '*', 'negotiated_rates', '*', 'provider_groups', '*'];
const referenceGroupPath = [...referencePath, 'provider_groups', '*'];
const usePath = ['in_network', '*', 'negotiated_rates', '*', 'provider_references', '*'];
const useContainerPath = usePath.slice(0, -1);
const ratePath = usePath.slice(0, -2);
const inlineGroupContainerPath = inlineGroupPath.slice(0, -1);
function bounded(value: number | undefined, fallback: number, name: string) {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0 || n > fallback) throw new Error('Invalid ' + name + ' cap');
  return n;
}
function sameFile(a: BigIntStats, b: BigIntStats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

export async function runDiskExtract(options: DiskExtractOptions): Promise<DiskExtractSummary> {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Disk extraction requires Node 24');
  if (/^[a-z][a-z0-9+.-]*:/i.test(options.input)) throw new Error('Disk extraction accepts local archived files only');
  const source = new URL(options.sourceUrl);
  if (source.protocol !== 'https:' || source.username || source.password || Buffer.byteLength(options.sourceUrl) > SCALAR_BYTES) throw new Error('Invalid source URL');
  const maxPairs = bounded(options.maxPairs, 200_000, 'membership');
  const maxMs = bounded(options.maxMs, 7_200_000, 'time');
  const maxScratch = bounded(options.maxScratchBytes, 4_000_000_000, 'scratch');
  const maxDecoded = bounded(options.maxDecodedBytes, 128_000_000_000, 'decoded');
  if (maxScratch < 65_536) throw new Error('scratch_limit: insufficient SQLite space');
  const started = performance.now(), root = resolve(options.scratchRoot), input = resolve(options.input), out = resolve(options.out);
  options.guard?.();
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await realpath(root) !== root) throw new Error('Scratch root must be an existing canonical directory');
  const outputParent = await lstat(dirname(out));
  if (!outputParent.isDirectory() || outputParent.dev !== rootStat.dev || await realpath(dirname(out)) !== dirname(out) || out === input) throw new Error('Output must have an existing directory on the scratch filesystem');
  try { const s = await lstat(out); if (!s.isFile() || s.isSymbolicLink()) throw new Error('Unsafe output target'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const disk: DiskExtractSummary['disk'] = { decodedBytes: 0, peakScratchBytes: 0, groups: 0, references: 0 };
  let handle: FileHandle | undefined, db: DatabaseSync | undefined, stage: string | undefined;
  let output: FileHandle | undefined, failure: Error | undefined, committed = false;
  let deadlineError: Error | undefined, timer: NodeJS.Timeout | undefined, checkError: unknown;
  const streams: Array<Readable | Writable> = [];
  const check = () => {
    try {
    options.guard?.();
    const current = lstatSync(root);
    if (current.dev !== rootStat.dev || current.ino !== rootStat.ino || realpathSync(root) !== root) throw new Error('Scratch root changed');
    if (deadlineError || performance.now() - started > maxMs) throw deadlineError ?? new Error('extraction_time_limit');
    } catch (error) { checkError ??= error; throw error; }
  };
  try {
    check();
    const named = await lstat(input, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink()) throw new Error('Input must be a regular local archive');
    handle = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const initial = await handle.stat({ bigint: true });
    if (!sameFile(initial, named)) throw new Error('Source changed before extraction');
    check(); stage = await mkdtemp(join(root, '.tic-disk-'));
    const dbPath = join(stage, 'extract.sqlite'), outputPath = join(stage, 'output.ndjson');
    check();
    await (await open(dbPath, 'wx', 0o600)).close();
    db = new DatabaseSync(dbPath, { allowExtension: false });
    // Every ordered query below has a maintained index. No SQLite sort/spill file
    // is needed; all persistent pages and the staged output live under this root.
    db.exec('PRAGMA page_size=4096; PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=MEMORY; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;');
    db.exec('PRAGMA max_page_count=' + Math.floor(maxScratch / 4096));
    db.exec(`
      CREATE TABLE refs(id INTEGER PRIMARY KEY, identifier TEXT UNIQUE);
      CREATE TABLE groups(id INTEGER PRIMARY KEY, ref INTEGER, tin_type TEXT NOT NULL DEFAULT '', tin_value TEXT NOT NULL DEFAULT '', has_npis INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX groups_ref ON groups(ref,id);
      CREATE TABLE npis(g INTEGER NOT NULL, raw TEXT NOT NULL, seq INTEGER NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(g,raw)) WITHOUT ROWID;
      CREATE INDEX npis_order ON npis(g,seq);
      CREATE TABLE uses(identifier TEXT PRIMARY KEY,seq INTEGER NOT NULL UNIQUE) WITHOUT ROWID;
      CREATE TABLE pairs(npi TEXT NOT NULL,tin_value TEXT NOT NULL,line TEXT NOT NULL,PRIMARY KEY(npi,tin_value)) WITHOUT ROWID;
      CREATE INDEX pairs_output ON pairs(line COLLATE BINARY);
      CREATE TABLE emitted_npis(npi TEXT PRIMARY KEY) WITHOUT ROWID;
      CREATE TABLE inline_pairs(npi TEXT NOT NULL,tin_value TEXT NOT NULL,tin_type TEXT NOT NULL,PRIMARY KEY(npi,tin_value)) WITHOUT ROWID;
      BEGIN;
    `);
    const addRef = db.prepare('INSERT INTO refs DEFAULT VALUES');
    const nameRef = db.prepare('UPDATE refs SET identifier=? WHERE id=?');
    const addGroup = db.prepare('INSERT INTO groups(ref) VALUES(?)');
    const finishGroup = db.prepare('UPDATE groups SET tin_type=?,tin_value=?,has_npis=? WHERE id=?');
    const addNpi = db.prepare('INSERT INTO npis(g,raw,seq) VALUES(?,?,?) ON CONFLICT(g,raw) DO UPDATE SET occurrences=occurrences+1');
    const addUse = db.prepare('INSERT OR IGNORE INTO uses VALUES(?,?)');
    const groupNpis = db.prepare('SELECT raw,occurrences FROM npis WHERE g=? ORDER BY seq');
    const inlinePair = db.prepare('INSERT OR IGNORE INTO inline_pairs VALUES(?,?,?)');
    const removeNpis = db.prepare('DELETE FROM npis WHERE g=?'), removeGroup = db.prepare('DELETE FROM groups WHERE id=?');
    const pages = db.prepare('PRAGMA page_count');
    let dbBytes = 0, outputBytes = 0, pairs = 0, npiCount = 0, sequence = 0, operations = 0, lastProgress = 0;
    let phase: DiskExtractProgress['phase'] = 'parse';
    const budget = () => {
      dbBytes = Number(pages.get()!.page_count) * 4096;
      disk.peakScratchBytes = Math.max(disk.peakScratchBytes, dbBytes + outputBytes);
      if (dbBytes + outputBytes > maxScratch) throw new Error('scratch_limit');
    };
    const checkpoint = () => {
      check(); budget();
      if (options.onProgress && (!lastProgress || performance.now() - lastProgress >= 30_000)) {
        lastProgress = performance.now();
        options.onProgress({ phase, decodedBytes: disk.decodedBytes, scratchBytes: dbBytes + outputBytes, groups: disk.groups, references: disk.references, pairs, elapsedMs: performance.now() - started });
      }
    };
    const frames: Frame[] = [];
    let activeRef: Frame | undefined, activeGroup: Frame | undefined;
    let rootClosed = false, sawReferences = false, scalar = '', scalarBytes = 0, scalarKind = '';
    let captureScalar = true;
    let inlineZero = 0, inlineTin = 0;
    const metadata = { reportingEntity: '', lastUpdatedOn: '', version: '' };
    const classify = (npi: string, tinType: string, tinValue: string) => {
      if (npi === '0') return 'zero';
      if (/^\d{9}$/.test(npi)) return 'tin';
      if (!/^\d{10}$/.test(npi)) return 'invalid';
      return tinType === 'ein' && npi === tinValue ? 'tin' : 'valid';
    };
    const compactInline = (frame: Frame) => {
      if (!sawReferences && frame.hasNpis && frame.tinType && frame.tinValue) {
        for (const row of groupNpis.iterate(frame.group!)) {
          if (++operations % 4096 === 0) checkpoint();
          const npi = String(row.raw), count = Number(row.occurrences);
          const kind = classify(npi, frame.tinType, frame.tinValue);
          if (kind === 'zero') inlineZero += count;
          else if (kind === 'tin') inlineTin += count;
          else if (kind === 'valid') inlinePair.run(npi, frame.tinValue, frame.tinType);
        }
      }
      removeNpis.run(frame.group!); removeGroup.run(frame.group!);
    };
    const nextPath = () => {
      const parent = frames.at(-1);
      if (!parent) return [];
      const path = [...parent.path, parent.kind === 'array' ? '*' : parent.key ?? ''];
      if (parent.kind === 'object') parent.key = undefined;
      return path;
    };
    const onScalar = (path: string[], raw: string, kind: string) => {
      if (equal(path, referencePath) || equal(path, referenceGroupPath) || equal(path, inlineGroupPath) || equal(path, ['provider_references']) || equal(path, usePath.slice(0, -1))) throw new Error('Malformed provider reference/group container');
      if (activeRef && equal(path, [...referencePath, 'provider_group_id'])) activeRef.identifier = raw.trim();
      if (activeRef && equal(path, [...referencePath, 'provider_groups'])) throw new Error('Unarchived or malformed provider reference');
      if (activeRef && equal(path, [...referencePath, 'location']) && raw && kind !== 'null' && kind !== 'false') throw new Error('Unarchived or malformed provider reference: external location');
      if (activeGroup) {
        const p = activeGroup.path;
        if (equal(path, [...p, 'tin', 'type'])) activeGroup.tinType = raw.trim().toLowerCase();
        if (equal(path, [...p, 'tin', 'value'])) activeGroup.tinValue = raw.trim();
        if (equal(path, [...p, 'npi', '*']) && !(activeGroup.inline && sawReferences)) addNpi.run(activeGroup.group!, raw.trim(), ++sequence);
      }
      if (equal(path, usePath)) {
        const id = raw.trim(); if (!id) throw new Error('Unresolved provider reference');
        addUse.run(id, ++sequence);
      }
      if (kind === 'string' || kind === 'number') {
        if (equal(path, ['reporting_entity_name'])) metadata.reportingEntity = raw;
        if (equal(path, ['last_updated_on'])) metadata.lastUpdatedOn = raw;
        if (equal(path, ['version'])) metadata.version = raw;
      }
    };
    // Prices/codes still pass the tokenizer, UTF-8/scalar/depth/key checks and EOF
    // validation. They need no copied path or retained scalar for memberships.
    const scalarRelevant = () => Boolean(activeRef || activeGroup || frames.at(-1)?.scalarRelevant);
    const emitScalar = (raw:string,kind:string) => {
      if (scalarRelevant()) onScalar(nextPath(),raw,kind);
      else { const parent=frames.at(-1); if(parent?.kind==='object')parent.key=undefined; }
    };
    const onToken = (token: Token) => {
      if (++operations % 4096 === 0) checkpoint();
      const name = token.name;
      if (name === 'startKey' || name === 'startString' || name === 'startNumber') {
        scalar = ''; scalarBytes = 0; scalarKind = name.slice(5).toLowerCase();
        captureScalar = name === 'startKey' || scalarRelevant(); return;
      }
      if (name === 'stringChunk' || name === 'numberChunk') {
        const text = String(token.value); scalarBytes += Buffer.byteLength(text);
        if (scalarBytes > SCALAR_BYTES) throw new Error('scalar_limit');
        if(captureScalar)scalar += text; return;
      }
      if (name === 'endKey') {
        const frame = frames.at(-1)!;
        frame.keyBytes += scalarBytes;
        if (frame.keyBytes > KEY_BYTES || frame.keys!.size >= 4096) throw new Error('object_key_limit');
        if (frame.keys!.has(scalar)) throw new Error('Duplicate JSON object key');
        frame.keys!.add(scalar); frame.key = scalar; return;
      }
      if (name === 'endString' || name === 'endNumber') { emitScalar(scalar, scalarKind); return; }
      if (name === 'trueValue' || name === 'falseValue' || name === 'nullValue') {
        const kind = name.slice(0, -5); emitScalar(kind === 'null' ? '' : kind, kind); return;
      }
      if (name === 'startObject' || name === 'startArray') {
        const path = nextPath(), kind = name === 'startObject' ? 'object' : 'array';
        if (frames.length >= DEPTH) throw new Error('depth_limit');
        if (!frames.length && (rootClosed || kind !== 'object')) throw new Error('Input must contain one JSON object');
        if (equal(path, ['provider_references'])) {
          if (kind !== 'array') throw new Error('Malformed provider references');
          sawReferences = true; db!.exec('DELETE FROM inline_pairs'); inlineZero = 0; inlineTin = 0;
        }
        if (equal(path, usePath) || (activeGroup && equal(path, [...activeGroup.path, 'npi', '*']))) throw new Error('Reference IDs and NPIs must be scalar');
        if (equal(path, usePath.slice(0, -1)) && kind !== 'array') throw new Error('Malformed provider reference uses');
        const frame: Frame = { kind, path, keyBytes: 0, keys: kind === 'object' ? new Set() : undefined,
          scalarRelevant: !path.length || equal(path,['provider_references']) || equal(path,useContainerPath) || equal(path,ratePath) || equal(path,inlineGroupContainerPath) };
        if (equal(path, referencePath)) {
          if (kind !== 'object') throw new Error('Malformed provider reference');
          frame.ref = Number(addRef.run().lastInsertRowid); activeRef = frame; disk.references++;
        }
        if (equal(path, [...referencePath, 'provider_groups'])) {
          if (kind !== 'array') throw new Error('Unarchived or malformed provider reference');
          activeRef!.hasGroups = true;
        }
        if (activeRef && equal(path, [...referencePath, 'location'])) throw new Error('Unarchived or malformed provider reference: external location');
        if (equal(path, inlineGroupPath) || equal(path, referenceGroupPath)) {
          if (kind !== 'object') throw new Error('Malformed provider group');
          frame.group = Number(addGroup.run(equal(path, referenceGroupPath) ? activeRef!.ref! : null).lastInsertRowid);
          frame.inline = equal(path, inlineGroupPath);
          activeGroup = frame; disk.groups++;
        }
        if (activeGroup && equal(path, [...activeGroup.path, 'npi']) && kind === 'array') activeGroup.hasNpis = true;
        frames.push(frame); return;
      }
      if (name === 'endObject' || name === 'endArray') {
        const frame = frames.pop()!;
        if (frame === activeGroup) {
          if (frame.inline) compactInline(frame);
          else finishGroup.run(frame.tinType ?? '', frame.tinValue ?? '', frame.hasNpis ? 1 : 0, frame.group!);
          activeGroup = undefined;
        }
        if (frame === activeRef) {
          if (!frame.identifier || !frame.hasGroups) throw new Error('Unarchived or malformed provider reference');
          try { nameRef.run(frame.identifier, frame.ref!); }
          catch (error) { if ((error as Error).message.includes('UNIQUE constraint')) throw new Error('Duplicate provider reference identifier'); throw error; }
          activeRef = undefined;
        }
        if (!frames.length) rootClosed = true;
      }
    };
    const prefix = Buffer.alloc(2); await handle.read(prefix, 0, 2, 0);
    let decoded: Readable, zip: ZipJsonReadable | undefined;
    if (prefix[0] === 0x50 && prefix[1] === 0x4b) {
      zip = await openZipJson(input, { maxDecodedBytes: Math.min(maxDecoded, 5_000_000_000), guard: check }); decoded = zip;
    } else {
      decoded = handle.createReadStream({ autoClose: false, start: 0, highWaterMark: 65_536 });
    }
    const utf8 = new TextDecoder('utf-8', { fatal: true });
    const meter = new Transform({ transform(chunk: Buffer, _, done) {
      try { check(); disk.decodedBytes += chunk.length; if (disk.decodedBytes > maxDecoded) throw new Error('decoded_limit'); utf8.decode(chunk, { stream: true }); done(null, chunk); }
      catch (error) { done(error as Error); }
    }, flush(done) { try { utf8.decode(); done(); } catch (error) { done(error as Error); } } });
    const tokenizer = parser({ packValues: false, streamValues: true, jsonStreaming: false });
    const sink = new Writable({ objectMode: true, write(token: Token, _, done) {
      try { onToken(token); done(); } catch (error) { done(error as Error); }
    } });
    streams.push(decoded);
    if (!zip && prefix[0] === 0x1f && prefix[1] === 0x8b) streams.push(createGunzip());
    streams.push(meter, tokenizer, sink);
    timer = setTimeout(() => { deadlineError = new Error('extraction_time_limit'); for (const s of streams) s.destroy(deadlineError); }, maxMs); timer.unref();
    await pipeline(streams);
    if (zip) await zip.verified;
    if (!rootClosed || frames.length) throw new Error('Incomplete JSON EOF');
    const after = await handle.stat({ bigint: true }), finalName = await lstat(input, { bigint: true });
    if (!sameFile(initial, after) || !sameFile(initial, finalName)) throw new Error('Source changed during extraction');
    checkpoint(); phase = 'resolve';
    const schema = sawReferences ? 'v1' : 'v2';
    const findRef = db.prepare('SELECT id FROM refs WHERE identifier=?');
    const orderedGroups = db.prepare('SELECT * FROM groups WHERE ref IS ? ORDER BY id');
    const insertPair = db.prepare('INSERT OR IGNORE INTO pairs VALUES(?,?,?)');
    const insertNpi = db.prepare('INSERT OR IGNORE INTO emitted_npis VALUES(?)');
    let zeroDropped = 0, tinDropped = 0;
    const emitPair = (npi: string, tinType: string, tinValue: string) => {
      const line = JSON.stringify({ npi, tin_type: tinType, tin_value: tinValue, file_url: options.sourceUrl, reporting_entity: metadata.reportingEntity, last_updated_on: metadata.lastUpdatedOn, schema });
      if (Number(insertPair.run(npi, tinValue, line).changes)) {
        if (++pairs > maxPairs) throw new Error('Membership limit exceeded');
        npiCount += Number(insertNpi.run(npi).changes);
      }
    };
    const emitGroups = async (ref: number | null) => {
      for (const group of orderedGroups.iterate(ref)) {
        if (!group.has_npis || !group.tin_type || !group.tin_value) continue;
        for (const row of groupNpis.iterate(group.id)) {
          if (++operations % 4096 === 0) { checkpoint(); await yieldLoop(); }
          const npi = String(row.raw), count = Number(row.occurrences), tinType = String(group.tin_type), tinValue = String(group.tin_value);
          const kind = classify(npi, tinType, tinValue);
          if (kind === 'zero') zeroDropped += count;
          else if (kind === 'tin') tinDropped += count;
          else if (kind === 'valid') emitPair(npi, tinType, tinValue);
        }
      }
    };
    // Iterate first-use order, not definition order. Repeated use IDs expand once,
    // preserving the legacy first-occurrence tin_type for a deduplicated pair.
    for (const use of db.prepare('SELECT identifier FROM uses ORDER BY seq').iterate()) {
      checkpoint(); const reference = findRef.get(use.identifier);
      if (!reference) throw new Error('Unresolved provider reference');
      await emitGroups(Number(reference.id));
    }
    if (!sawReferences) {
      zeroDropped = inlineZero; tinDropped = inlineTin;
      for (const row of db.prepare('SELECT npi,tin_type,tin_value FROM inline_pairs ORDER BY npi,tin_value').iterate()) {
        if (++operations % 4096 === 0) { checkpoint(); await yieldLoop(); }
        emitPair(String(row.npi), String(row.tin_type), String(row.tin_value));
      }
    }
    checkpoint(); phase = 'output'; db.exec('COMMIT'); budget();
    check(); output = await open(outputPath, 'wx', 0o600);
    let buffer = '';
    const flush = async () => {
      if (!buffer) return;
      check(); outputBytes += Buffer.byteLength(buffer); budget();
      await output!.writeFile(buffer); buffer = '';
    };
    for (const row of db.prepare('SELECT line FROM pairs ORDER BY line COLLATE BINARY').iterate()) {
      if (++operations % 1024 === 0) checkpoint();
      buffer += String(row.line) + '\n'; if (Buffer.byteLength(buffer) >= 65_536) await flush();
    }
    await flush(); await output.sync(); await output.close(); output = undefined;
    db.close(); db = undefined;
    if (!sameFile(initial, await handle.stat({ bigint: true })) || !sameFile(initial, await lstat(input, { bigint: true }))) throw new Error('Source changed during extraction');
    await handle.close(); handle = undefined;
    check(); await rename(outputPath, out); committed = true;
    return { files: 1, npis_emitted: npiCount, pairs_emitted: pairs, zero_npi_dropped: zeroDropped, tin_in_npi_dropped: tinDropped,
      remote_refs_fetched: 0, remote_refs_404: 0, schema, seconds: Number(((performance.now() - started) / 1000).toFixed(3)), peak_rss_mb: Math.round(process.resourceUsage().maxRSS / 1024), disk,
      validation:{policy:'tic-membership-v1-strict',extractorRevision,jsonEof:true,archiveIntegrity:true,referenceClosure:true,sourceStable:true,limits:{maxPairs,maxMs,maxScratchBytes:maxScratch,maxDecodedBytes:maxDecoded}} };
  } catch (error) {
    // ZIP integrity adapters wrap guard exceptions. Preserve the caller's exact
    // deferral error so the scheduler can still distinguish storage loss.
    error = checkError ?? error;
    failure = error instanceof Error ? error : new Error('Disk extraction failed', { cause: error });
    if (failure.message.includes('database or disk is full')) failure = new Error('scratch_limit', { cause: failure });
    throw failure;
  } finally {
    if (timer) clearTimeout(timer);
    for (const stream of streams) stream.destroy();
    try { db?.close(); } catch { /* scratch pages are never accepted after failure */ }
    await output?.close().catch(() => {}); await handle?.close().catch(() => {});
    if (stage) {
      try {
        options.guard?.();
        const current = await lstat(root);
        if (current.dev !== rootStat.dev || current.ino !== rootStat.ino || await realpath(root) !== root) throw new Error('Scratch root changed');
        await rm(stage, { recursive: true, force: true });
      } catch (cleanupError) {
        // A disconnected SSD cannot be cleaned safely. Keep the exact location
        // explicit for its owner rather than deleting through a replacement mount.
        if (failure) Object.assign(failure, { cleanupPending: true, scratchPath: stage, cleanupError });
        else if (committed) Object.assign(disk, { cleanupPending: true, scratchPath: stage });
        else throw cleanupError;
      }
    }
  }
}
