/** Four official employer inventories produce URL selections, never synthetic plan mappings. */
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';
import { createIssuerDiscoverer, IssuerDiscoveryError } from './issuer-discovery';

export const ANTHEM_SELECTION_EINS = Object.freeze(['310345740', '340451060', '311188630', '061553489']);
export const ANTHEM_SELECTION_LIMITS = Object.freeze({
  documentBytes: 1_000_000, totalDocumentBytes: 4_000_000, candidates: 400,
  referencesPerDocument: 2_000, selectionBytes: 1_000_000, requestMs: 30_000, totalMs: 180_000,
});
type Limits = { -readonly [K in keyof typeof ANTHEM_SELECTION_LIMITS]: number };
const EAST1 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/';
const EAST2 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east2.s3.us-east-2.amazonaws.com/';
const SCOPE = 'URLs from four current-month Anthem EIN inventories only; canonical reporting_plans require the complete validated TOC; whole-plan and national completeness unverified';
export interface AnthemSelectionOptions { guard?: () => void }
export interface AnthemSelectionResult {
  directory: string; selectedPath: string; selectionPath: string; receiptPath: string; selectedCount: number; tocUrl: string;
  sourceMonth: string; sourceDate: string | null; sourceDates: string[]; tocSourceDate: null; unresolvedEins: string[]; scope: string;
}
export class AnthemSelectionError extends Error {
  receiptPath?: string; receiptWritten = false;
  constructor(public readonly code: 'source' | 'limit' | 'http' | 'timeout' | 'storage', message: string) {
    super(message); this.name = 'AnthemSelectionError';
  }
}
function fail(code: AnthemSelectionError['code'], message: string): never { throw new AnthemSelectionError(code, message); }
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const SIGNATURE_KEYS = new Set(['signature', 'expires', 'policy', 'key-pair-id', 'x-amz-algorithm',
  'x-amz-credential', 'x-amz-date', 'x-amz-expires', 'x-amz-signedheaders', 'x-amz-signature', 'x-amz-security-token']);
function candidateIdentity(value: unknown) {
  if (typeof value !== 'string' || value.length > 65_536) return fail('source', 'Malformed or oversized Anthem source URL');
  let u: URL;
  try { u = new URL(value); } catch { return fail('source', 'Malformed Anthem source URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) fail('source', 'Anthem source URL requires HTTPS without credentials, port or fragment');
  const known = [new URL(EAST1).hostname, new URL(EAST2).hostname].includes(u.hostname) ||
    /^[a-z0-9-]+\.mrf\.bcbs\.com$/.test(u.hostname);
  if (!known) fail('source', 'New Anthem in-network host requires source review; no candidate silently omitted');
  const parts = u.search.slice(1).split('&').filter(part => {
    if (!part) return false;
    let key: string;
    try { key = decodeURIComponent(part.split('=', 1)[0].replace(/\+/g, ' ')).toLowerCase(); }
    catch { return fail('source', 'Malformed source query encoding'); }
    return !SIGNATURE_KEYS.has(key);
  });
  return u.origin + u.pathname + (parts.length ? '?' + parts.join('&') : '');
}
function sourceDate(value: unknown, observed: Date) {
  if (typeof value !== 'string') return fail('source', 'Anthem document lacks its actual update date');
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== value || ms > observed.getTime() ||
      value.slice(0, 7) !== observed.toISOString().slice(0, 7)) fail('source', 'Anthem document is undated, invalid, future-dated or outside the current month');
  return value;
}
type Dependencies = { fetch?: typeof fetch; now?: () => Date; limits?: Partial<Limits> };
export function createAnthemSelectionDiscoverer(deps: Dependencies = {}) {
  const fetcher = deps.fetch ?? globalThis.fetch, now = deps.now ?? (() => new Date());
  const limits: Limits = { ...ANTHEM_SELECTION_LIMITS, ...deps.limits };
  for (const key of Object.keys(limits) as Array<keyof Limits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > ANTHEM_SELECTION_LIMITS[key]) fail('limit', 'Selection limits must be positive integers at or below tested maxima');
  }
  const discoverIssuer = createIssuerDiscoverer({
    fetch: fetcher, now, limits: { requestMs: limits.requestMs, totalMs: Math.min(limits.totalMs, 120_000) },
  });
  return async function discover(archiveDir: string, options: AnthemSelectionOptions = {}): Promise<AnthemSelectionResult> {
    const guard = () => { try { options.guard?.(); } catch { fail('storage', 'Anthem selection storage identity guard failed'); } };
    const observed = now(), month = observed.toISOString().slice(0, 7), root = resolve(archiveDir);
    guard();
    let info;
    try { info = await lstat(root); } catch { return fail('storage', 'Anthem selection archive root must already exist'); }
    if (!info.isDirectory() || info.isSymbolicLink()) fail('storage', 'Anthem selection archive root must be an existing directory');
    guard(); const run = await mkdtemp(join(root, '.anthem-selection-'));
    const receiptPath = join(run, 'receipt.json'), overall = AbortSignal.timeout(limits.totalMs);
    const documents: Array<Record<string, unknown>> = [], candidates = new Map<string, { url: string; eins: string[] }>();
    const unresolvedEins: string[] = [], dates = new Set<string>();
    const receipt: Record<string, unknown> = {
      version: 1, observedAt: observed.toISOString(), sourceMonth: month, scope: SCOPE, status: 'running',
      einsRequested: ANTHEM_SELECTION_EINS, documents, unresolvedEins, plansSynthesized: false, canonicalMappingsValidated: false, limits,
    };
    let downloaded = 0;
    try {
      // Reuse the official page/script/status/HEAD resolver and its hashed archive.
      // Its typed block is expected: EIN documents are selection hints, not TOC mappings.
      let resolverManifest: string;
      try {
        await discoverIssuer('anthem', run, { guard });
        return fail('source', 'Anthem resolver contract changed; review before selection');
      } catch (error) {
        if (!(error instanceof IssuerDiscoveryError) || error.code !== 'blocked_large_toc' || !error.manifestPath) throw error;
        resolverManifest = error.manifestPath;
      }
      guard();
      const resolverBytes = await readFile(resolverManifest!);
      if (resolverBytes.length > 1_000_000) fail('limit', 'Official resolver receipt exceeds its byte cap');
      const resolver = JSON.parse(resolverBytes.toString());
      const tocUrl = resolver.blockedInventory?.tocUrl;
      const bucket = [EAST1, EAST2].find(base => tocUrl === base + 'anthem/' + month + '-01_anthem_index.json.gz');
      if (!bucket || resolver.status !== 'blocked') fail('source', 'Official Anthem resolver did not identify a current-month bucket');
      receipt.resolver = { file: relative(run, resolverManifest!), sha256: hash(resolverBytes), tocUrl,
        contentLength: resolver.blockedInventory.contentLength, sourceDate: null, meaning: 'Official TOC HEAD size only; no TOC body or canonical plan map read' };
      for (const ein of ANTHEM_SELECTION_EINS) {
        guard();
        const endpoint = bucket + 'anthem/' + ein + '.json';
        const record: Record<string, unknown> = { ein, url: endpoint, observedAt: now().toISOString(), complete: false };
        documents.push(record);
        const signal = AbortSignal.any([overall, AbortSignal.timeout(limits.requestMs)]);
        let abort: (() => void) | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const aborted = new Promise<never>((_, reject) => {
          abort = () => reject(new AnthemSelectionError('timeout', 'Anthem metadata request exceeded its time limit'));
          signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
        });
        let bytes: Buffer;
        try {
          const response = await Promise.race([fetcher(endpoint, {
            redirect: 'manual', signal, headers: { 'User-Agent': 'affinity-source-discovery/1.0', 'Accept-Encoding': 'identity' },
          }), aborted]).catch(error => { throw error instanceof AnthemSelectionError ? error : new AnthemSelectionError('http', 'Official Anthem metadata transport failed'); });
          record.status = response.status;
          record.etag = response.headers.get('etag'); record.lastModified = response.headers.get('last-modified');
          const length = response.headers.get('content-length'), encoding = response.headers.get('content-encoding');
          if ((length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limits.documentBytes)) ||
              (encoding && encoding !== 'identity')) {
            void response.body?.cancel().catch(() => {}); fail('limit', 'Anthem document size or content encoding exceeds the source contract');
          }
          reader = response.body?.getReader(); const chunks: Buffer[] = []; let count = 0;
          if (reader) for (;;) {
            const item = await Promise.race([reader.read(), aborted]); guard();
            if (item.done) break;
            count += item.value.length; downloaded += item.value.length; record.bytesRead = count;
            if (count > limits.documentBytes || downloaded > limits.totalDocumentBytes) fail('limit', 'Anthem document download exceeds byte caps');
            chunks.push(Buffer.from(item.value));
          }
          bytes = Buffer.concat(chunks);
          const file = hash(bytes) + '.json'; guard();
          try { await writeFile(join(run, file), bytes, { flag: 'wx', mode: 0o600 }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          Object.assign(record, { file, sha256: hash(bytes), bytes: bytes.length });
          if (length !== null && Number(length) !== count) fail('source', 'Anthem metadata response length mismatch');
          record.complete = true;
          if (response.status !== 200) fail('http', 'Official Anthem EIN document did not return HTTP 200');
        } finally {
          if (abort) signal.removeEventListener('abort', abort);
          void reader?.cancel().catch(() => {});
        }
        let document: Record<string, unknown>;
        try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes!)); }
        catch { return fail('source', 'Invalid Anthem EIN metadata JSON'); }
        if (!document || typeof document !== 'object' || Array.isArray(document)) fail('source', 'Invalid Anthem EIN metadata root');
        const updated = sourceDate(document.lastupdated, observed); dates.add(updated); record.sourceDate = updated;
        const files = document['In-Network Negotiated Rates Files'];
        if (!Array.isArray(files) || files.length > limits.referencesPerDocument) fail('source', 'Missing or oversized Anthem in-network reference array');
        record.categories = Object.fromEntries(Object.entries(document).filter(([,v]) => Array.isArray(v)).map(([k,v]) => [k,(v as unknown[]).length]));
        if (!files.length) unresolvedEins.push(ein);
        for (const file of files) {
          if (!file || typeof file !== 'object' || Array.isArray(file)) fail('source', 'Malformed Anthem in-network reference');
          const row = file as Record<string, unknown>, key = candidateIdentity(row.url);
          if (row.displayname !== undefined && typeof row.displayname !== 'string') fail('source', 'Malformed Anthem reference label');
          const existing = candidates.get(key);
          if (existing) { if (!existing.eins.includes(ein)) existing.eins.push(ein); }
          else candidates.set(key, { url: row.url as string, eins: [ein] });
          if (candidates.size > limits.candidates) fail('limit', 'Anthem selected-file count exceeds the builder cap; no files silently dropped');
        }
      }
      if (overall.aborted) fail('timeout', 'Anthem selection exceeded its total deadline');
      const sorted = [...candidates.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0);
      const selectionBytes = Buffer.from(JSON.stringify(sorted.map(([,item]) => item.url), null, 2) + '\n');
      if (selectionBytes.length > limits.selectionBytes) fail('limit', 'Anthem selection JSON exceeds the builder input cap');
      guard(); await writeFile(join(run, 'selected-urls.json'), selectionBytes, { flag: 'wx', mode: 0o600 });
      receipt.status = unresolvedEins.length ? 'partial' : 'four-employer-selection-complete';
      receipt.sourceDates = [...dates].sort();
      receipt.unresolved = unresolvedEins.map(ein => ({ ein, reason: 'No in-network URLs in this current document; employer retirement and plan coverage remain unknown' }));
      receipt.selection = { file: 'selected-urls.json', sha256: hash(selectionBytes), count: candidates.size,
        candidates: sorted.map(([identity,item]) => ({ identitySha256: hash(identity), urlSha256: hash(item.url), eins: item.eins })) };
      receipt.finishedAt = now().toISOString(); receipt.downloadedDocumentBytes = downloaded;
      guard(); await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      const directory = join(root, basename(run).slice(1));
      guard();
      try { await lstat(directory); fail('storage', 'Anthem selection destination already exists'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      guard(); await rename(run, directory);
      return { directory, selectedPath: join(directory, 'selected-urls.json'), selectionPath: join(directory, 'selected-urls.json'), receiptPath: join(directory, 'receipt.json'),
        selectedCount: candidates.size, tocUrl: String(tocUrl), sourceMonth: month, sourceDate: dates.size === 1 ? [...dates][0] : null,
        sourceDates: [...dates].sort(), tocSourceDate: null, unresolvedEins, scope: SCOPE };
    } catch (error) {
      const upstreamCode = error instanceof IssuerDiscoveryError ? error.code : undefined;
      const safe = error instanceof AnthemSelectionError ? error : new AnthemSelectionError(
        upstreamCode === 'archive' ? 'storage' : upstreamCode === 'timeout' ? 'timeout' :
          upstreamCode === 'http' ? 'http' : upstreamCode === 'limit' ? 'limit' : 'source',
        'Anthem selection failed; inspect protected metadata receipts');
      safe.receiptPath = receiptPath;
      receipt.status = 'failed'; receipt.error = { code: safe.code, message: safe.message };
      receipt.finishedAt = now().toISOString(); receipt.downloadedDocumentBytes = downloaded;
      try { guard(); await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); safe.receiptWritten = true; } catch {}
      throw safe;
    }
  };
}
const defaultDiscoverer = createAnthemSelectionDiscoverer();
export async function discoverAnthemSelection(archiveDir: string, options?: AnthemSelectionOptions): Promise<AnthemSelectionResult> {
  return defaultDiscoverer(archiveDir, options);
}
