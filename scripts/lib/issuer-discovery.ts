/** Metadata discovery only. Returned signed URLs must never be logged by callers. */
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync, inflateRawSync } from 'node:zlib';

export type Issuer = 'mmoh' | 'cigna' | 'anthem';
export interface IssuerDiscovery {
  tocPath: string;
  tocUrl: string;
  sourceDate: string;
  candidates: Array<{ url: string; stableKey: string }>;
  scope: string;
}
export type DiscoveryCode = 'http' | 'timeout' | 'limit' | 'invalid_source' | 'unsupported' | 'blocked_large_toc' | 'archive';
export class IssuerDiscoveryError extends Error {
  constructor(public readonly code: DiscoveryCode, message: string, public manifestPath = '') {
    super(message); this.name = 'IssuerDiscoveryError';
  }
}
const fail = (code: DiscoveryCode, message: string): never => { throw new IssuerDiscoveryError(code, message); };
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('invalid_source', 'Expected a source object');
  return v as Record<string, unknown>;
};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : fail('invalid_source', 'Expected a source array');
const string = (v: unknown): string => typeof v === 'string' && v.length > 0 ? v : fail('invalid_source', 'Expected a source string');
function url(value: unknown): URL {
  let u: URL;
  try { u = new URL(string(value)); } catch { return fail('invalid_source', 'Invalid source URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash) fail('invalid_source', 'Source URL must be public HTTPS without credentials, port or fragment');
  return u;
}
function redacted(value: string) {
  const u = new URL(value); return u.origin + u.pathname;
}
function identity(u: URL) {
  // Drop only known transport signatures. Other query parameters can select different
  // files; hash them rather than collapsing sources or putting query values in manifests.
  const semantic = new URLSearchParams();
  for (const [key, value] of u.searchParams) {
    if (!['signature', 'expires', 'policy', 'key-pair-id'].includes(key.toLowerCase()) && !key.toLowerCase().startsWith('x-amz-')) semantic.append(key, value);
  }
  semantic.sort();
  return u.origin + u.pathname + (semantic.size ? '?query-sha256=' + hash(semantic.toString()) : '');
}
function json(bytes: Buffer): Record<string, unknown> {
  try { return object(JSON.parse(bytes.toString('utf8'))); }
  catch { return fail('invalid_source', 'Invalid source JSON'); }
}
function date(value: unknown, now: Date): string {
  const s = string(value), ms = Date.parse(s);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== s ||
      ms > now.getTime() || now.getTime() - ms > 60 * 86_400_000) fail('invalid_source', 'Source date is invalid, stale or future-dated');
  return s;
}

export const CIGNA_NETWORKS = [
  'chicago-il-connect-network', 'cigna-managed-care-hmo-of-nh', 'florida-connect', 'houston-flexcare',
  'indianapolis-hmo', 'metro-new-york-gppo', 'metro-ny-seamless-hmo-network', 'nc-connect-hmo-rural',
  'north-new-jersey-hmo', 'orlando-ipa-hmo', 'pittsburgh-gppo', 'san-antonio-commercial',
  'south-carolina', 'st-louis-hmo', 'tampa-ipa-mixed-hmo', 'wichita-gppo',
] as const;
export const DISCOVERY_LIMITS = Object.freeze({
  requestMs: 30_000, totalMs: 120_000, metadataBytes: 2_000_000, tocBytes: 10_000_000,
  decodedBytes: 100_000_000, totalBytes: 20_000_000, zipEntries: 32, candidates: 10_000,
});
type Limits = { -readonly [K in keyof typeof DISCOVERY_LIMITS]: number };
type Dependencies = { fetch?: typeof fetch; now?: () => Date; limits?: Partial<Limits> };
export interface DiscoveryOptions { guard?: () => void }
const MMO_PAGE = 'https://www.medmutual.com/Employers/No-Surprises-Act-Transparency-Under-the-Consolidated-Appropriations-Act-2021.aspx';
const MMO_ROUTE = 'https://www.medmutual.com/mrf';
const CIGNA_PAGE = 'https://www.cigna.com/legal/compliance/machine-readable-files';
const CIGNA_LATEST = 'https://www.cigna.com/static/mrf/latest.json';
const ANTHEM_PAGE = 'https://www.anthem.com/machine-readable-file/search/';
const ANTHEM_SCRIPT = ANTHEM_PAGE + 'script.js';
const EAST1 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/';
const EAST2 = 'https://antm-pt-prod-dataz-nogbd-nophi-us-east2.s3.us-east-2.amazonaws.com/';
const FETCH_HOSTS = new Set([
  'www.medmutual.com', 'medmutual.healthsparq.com', 'mrf.healthsparq.com', 'www.cigna.com',
  'd25kgz5rikkq4n.cloudfront.net', 'www.anthem.com', new URL(EAST1).hostname, new URL(EAST2).hostname,
]);
function fetchUrl(value: string) {
  const u = url(value);
  if (!FETCH_HOSTS.has(u.hostname)) fail('invalid_source', 'Unrecognized metadata host; review official discovery');
  const p = u.pathname;
  const permitted = u.hostname === 'www.cigna.com' ? /^\/(?:legal\/compliance\/machine-readable-files\/?|static\/mrf\/latest\.json)$/.test(p) :
    u.hostname === 'd25kgz5rikkq4n.cloudfront.net' ? /^\/cost_transparency\/mrf\/table-of-contents-zip\/reporting_month=\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}_cigna-partners-toc-collection\.zip$/.test(p) :
    u.hostname === 'www.medmutual.com' ? p === new URL(MMO_PAGE).pathname || p === new URL(MMO_PAGE).pathname.replace('.aspx', '') || p === '/mrf' :
    u.hostname === 'mrf.healthsparq.com' ? /^\/mmo-egress\.nophi\.kyruushsq\.com\/prd\/mrf\/MMO_I\/MMO\/\d{4}-\d{2}-\d{2}\/tableOfContents\/\d{4}-\d{2}-\d{2}_Medical-Mutual-Of-Ohio_index\.json\.gz$/.test(p) :
    u.hostname === 'www.anthem.com' ? /^\/machine-readable-file\/search\/(?:script\.js)?$/.test(p) :
    [new URL(EAST1).hostname, new URL(EAST2).hostname].includes(u.hostname) ? /^\/(?:status\.json|anthem\/\d{4}-\d{2}-01_anthem_index\.json\.gz)$/.test(p) : false;
  if (!permitted) fail('invalid_source', 'Unrecognized metadata path; rate downloads are forbidden during discovery');
  return u;
}

/** Safe ZIP32 extraction: fixed selected member, no filesystem extraction or archive-supplied paths. */
function unzipPrimary(bytes: Buffer, expected: string, limits: Limits): { bytes: Buffer; member: string } {
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65_557); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  if (end < 0) return fail('invalid_source', 'Missing ZIP directory');
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12), start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || count !== bytes.readUInt16LE(end + 8) ||
      count === 0xffff || start === 0xffffffff || size === 0xffffffff) fail('unsupported', 'Multipart/ZIP64 TOC requires a reviewed adapter');
  if (!count || count > limits.zipEntries || start + size !== end) fail('limit', 'ZIP directory exceeds discovery limits or is inconsistent');
  const seen = new Set<string>();
  let offset = start, result: { bytes: Buffer; member: string } | undefined;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) fail('invalid_source', 'Invalid ZIP member directory');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const crc = bytes.readUInt32LE(offset + 16), compressed = bytes.readUInt32LE(offset + 20), decoded = bytes.readUInt32LE(offset + 24);
    const n = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42), next = offset + 46 + n + extra + comment;
    if (next > end) fail('invalid_source', 'Truncated ZIP member directory');
    const name = bytes.subarray(offset + 46, offset + 46 + n).toString('utf8');
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..' || seen.has(name.toLowerCase()) ||
        (bytes.readUInt32LE(offset + 38) >>> 16 & 0xf000) === 0xa000) fail('invalid_source', 'Unsafe or duplicate ZIP member');
    seen.add(name.toLowerCase());
    if (flags & 1 || ![0, 8].includes(method)) fail('unsupported', 'Unsupported ZIP encoding');
    if (compressed > limits.tocBytes || decoded > limits.decodedBytes) fail('limit', 'ZIP member exceeds discovery limits');
    if (name === expected) {
      if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50 ||
          bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) fail('invalid_source', 'Inconsistent ZIP local header');
      if (!(flags & 8) && (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== compressed ||
          bytes.readUInt32LE(local + 22) !== decoded)) fail('invalid_source', 'Inconsistent ZIP local sizes or CRC');
      const ln = bytes.readUInt16LE(local + 26), le = bytes.readUInt16LE(local + 28), body = local + 30 + ln + le;
      if (bytes.subarray(local + 30, local + 30 + ln).toString('utf8') !== name || body + compressed > start) fail('invalid_source', 'Invalid ZIP member bounds');
      let raw: Buffer;
      try {
        raw = method === 0 ? bytes.subarray(body, body + compressed) :
          inflateRawSync(bytes.subarray(body, body + compressed), { maxOutputLength: limits.decodedBytes });
      } catch { return fail('invalid_source', 'Invalid or oversized ZIP member data'); }
      if (raw.length !== decoded || crc32(raw) !== crc) fail('invalid_source', 'ZIP member length or CRC mismatch');
      result = { bytes: raw, member: name };
    }
    offset = next;
  }
  if (offset !== end || !result) return fail('invalid_source', 'Primary Cigna TOC is missing or directory is inconsistent');
  return result;
}
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function decodeToc(bytes: Buffer, limits: Limits) {
  let raw: Buffer;
  try { raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: limits.decodedBytes }) : bytes; }
  catch { return fail('invalid_source', 'Invalid or oversized gzip TOC'); }
  if (raw.length > limits.decodedBytes) fail('limit', 'Decoded TOC exceeds discovery limit');
  return json(raw);
}
function tocFiles(toc: Record<string, unknown>, expectedEntity: string, now: Date, limits: Limits) {
  if (toc.reporting_entity_name !== expectedEntity || !/^2\.\d+\.\d+$/.test(string(toc.version))) fail('invalid_source', 'Unexpected TOC reporting entity or version');
  const sourceDate = date(toc.last_updated_on, now), files = new Map<string, string>();
  for (const raw of array(toc.reporting_structure)) {
    const structure = object(raw), entries = structure.in_network_files === undefined ? [] : array(structure.in_network_files);
    if (!entries.length) continue;
    const plans = array(structure.reporting_plans);
    if (!plans.length) fail('invalid_source', 'In-network files lack reporting plans');
    for (const p of plans) {
      const plan = object(p);
      if (!['ein', 'hios'].includes(string(plan.plan_id_type).toLowerCase())) fail('invalid_source', 'Unexpected plan identifier type');
      string(plan.plan_id); string(plan.plan_name);
    }
    for (const rawFile of entries) {
      const u = url(object(rawFile).location), key = identity(u);
      files.set(key, files.get(key) ?? u.href);
      if (files.size > limits.candidates) fail('limit', 'TOC candidate inventory exceeds discovery limit');
    }
  }
  if (!files.size) fail('invalid_source', 'TOC has no mapped in-network files');
  return { sourceDate, files };
}

/** Dependency injection keeps hostile-source and timeout tests offline; production uses native fetch. */
export function createIssuerDiscoverer(deps: Dependencies = {}) {
  const fetcher = deps.fetch ?? globalThis.fetch, now = deps.now ?? (() => new Date());
  const limits: Limits = { ...DISCOVERY_LIMITS, ...deps.limits };
  return async function discover(issuer: Issuer, archiveDir: string, options: DiscoveryOptions = {}, fourthOptions?: DiscoveryOptions): Promise<IssuerDiscovery> {
    // Accept the originally requested two arguments, options in position three, or the
    // integration caller's position-four guard. Never create the archive root or its parents.
    const checkGuard = () => {
      try { options.guard?.(); fourthOptions?.guard?.(); }
      catch { fail('archive', 'Archive device identity guard failed'); }
    };
    checkGuard();
    let root;
    try { root = await lstat(archiveDir); }
    catch { return fail('archive', 'Archive root must already exist on the verified device'); }
    if (!root.isDirectory() || root.isSymbolicLink()) fail('archive', 'Archive root must be an existing directory');
    checkGuard();
    const directory = await mkdtemp(join(archiveDir, 'discovery-' + issuer + '-'));
    const manifestPath = join(directory, 'manifest.json');
    const manifest: Record<string, unknown> = {
      version: 1, issuer, startedAt: now().toISOString(), status: 'running', limits,
      claims: 'Metadata discovery only; no rate downloads or complete-plan certification.',
      downloads: [], derived: [], unresolved: [],
    };
    const downloads = manifest.downloads as Record<string, unknown>[], derived = manifest.derived as Record<string, unknown>[];
    const overall = AbortSignal.timeout(limits.totalMs);
    let totalBytes = 0;
    async function archive(bytes: Buffer, extension: string) {
      const sha256 = hash(bytes), name = sha256 + '.' + extension;
      checkGuard();
      try { await writeFile(join(directory, name), bytes, { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      return { path: join(directory, name), file: name, sha256, bytes: bytes.length };
    }
    async function request(input: string, cap: number, method: 'GET' | 'HEAD' = 'GET', allowRedirect = false, depth = 0): Promise<{ body: Buffer; response: Response; location?: string; artifact?: Awaited<ReturnType<typeof archive>> }> {
      const u = fetchUrl(input);
      checkGuard();
      if (depth > 4) fail('invalid_source', 'Metadata redirect limit exceeded');
      const signal = AbortSignal.any([overall, AbortSignal.timeout(limits.requestMs)]);
      const receipt: Record<string, unknown> = { url: redacted(u.href), urlSha256: hash(u.href), method, observedAt: now().toISOString(), complete: false };
      downloads.push(receipt);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new IssuerDiscoveryError('timeout', 'Metadata request exceeded its time limit'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      try {
        const response = await Promise.race([fetcher(u.href, { method, redirect: 'manual', signal, headers: { 'User-Agent': 'affinity-source-discovery/1.0', 'Accept-Encoding': 'identity' } }), aborted])
          .catch(error => { throw error instanceof IssuerDiscoveryError ? error : new IssuerDiscoveryError('http', 'Official metadata transport failed'); });
        receipt.status = response.status;
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) fail('invalid_source', 'Invalid metadata content length');
        receipt.contentLength = length === null ? null : Number(length);
        receipt.lastModified = response.headers.get('last-modified');
        receipt.etag = response.headers.get('etag');
        receipt.contentEncoding = response.headers.get('content-encoding');
        if (receipt.contentEncoding && receipt.contentEncoding !== 'identity') {
          void response.body?.cancel().catch(() => {});
          fail('unsupported', 'Unexpected HTTP content encoding; original metadata bytes require identity transport');
        }
        const location = response.headers.get('location');
        if (location) { const resolved = new URL(location, u); receipt.location = redacted(resolved.href); receipt.locationSha256 = hash(resolved.href); }
        if (method === 'HEAD') {
          void response.body?.cancel().catch(() => {}); receipt.complete = response.ok;
          if (!response.ok) fail('http', 'Official TOC HEAD request failed');
          return { body: Buffer.alloc(0), response };
        }
        if (length !== null && Number(length) > cap) { void response.body?.cancel().catch(() => {}); fail('limit', 'Metadata download exceeds byte limit'); }
        const chunks: Buffer[] = []; let read = 0;
        reader = response.body?.getReader();
        if (reader) for (;;) {
          const item = await Promise.race([reader.read(), aborted]);
          checkGuard();
          if (item.done) break;
          read += item.value.length; totalBytes += item.value.length; receipt.bytesRead = read;
          if (read > cap || totalBytes > limits.totalBytes) fail('limit', 'Metadata download exceeds byte limit');
          chunks.push(Buffer.from(item.value));
        }
        const body = Buffer.concat(chunks), artifact = await archive(body, 'source');
        Object.assign(receipt, artifact, { path: undefined });
        if (length !== null && read !== Number(length)) fail('invalid_source', 'Metadata response length mismatch');
        receipt.complete = true;
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (!location) fail('invalid_source', 'Metadata redirect has no destination');
          const destination = new URL(string(location), u).href;
          if (!allowRedirect) return { body, response, location: destination, artifact };
          return await request(destination, cap, method, true, depth + 1);
        }
        if (!response.ok) fail('http', 'Official metadata request failed');
        return { body, response, artifact };
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
        // Cancellation is best-effort cleanup, never an unbounded extension of the deadline.
        void reader?.cancel().catch(() => {});
      }
    }
    async function saveDerived(bytes: Buffer, parentSha256: string, role: string) {
      if (bytes.length > limits.tocBytes) fail('limit', 'Normalized TOC exceeds archive byte limit');
      const artifact = await archive(bytes, 'json.gz');
      derived.push({ ...artifact, path: undefined, parentSha256, role, decodedSha256: hash(gunzipSync(bytes, { maxOutputLength: limits.decodedBytes })) });
      return artifact.path;
    }
    let result: IssuerDiscovery | undefined;
    try {
      if (issuer === 'cigna') {
        const page = await request(CIGNA_PAGE, limits.metadataBytes, 'GET', true);
        if (!/data-mrf-lookup-url=["']\/static\/mrf\/latest\.json["']/.test(page.body.toString())) fail('unsupported', 'Cigna official lookup contract changed');
        const latest = await request(CIGNA_LATEST, limits.metadataBytes);
        const entries = array(json(latest.body).mrfs).filter(x => object(x).program === 'cost_transparency' && object(x).kind === 'TOC');
        if (entries.length !== 1) fail('invalid_source', 'Ambiguous Cigna TOC resolver');
        const files = array(object(entries[0]).files);
        if (files.length !== 1) fail('invalid_source', 'Ambiguous Cigna TOC collection');
        const file = object(files[0]), sourceDate = date(file.last_updated_on, now()), tocUrl = url(file.url).href;
        const expected = sourceDate + '_cigna-health-life-insurance-company_index.json';
        const collection = new URL(tocUrl);
        if (collection.hostname !== 'd25kgz5rikkq4n.cloudfront.net' ||
            collection.pathname !== '/cost_transparency/mrf/table-of-contents-zip/reporting_month=' + sourceDate.slice(0, 7) + '/' + sourceDate + '_cigna-partners-toc-collection.zip' ||
            file.file_name !== sourceDate + '_cigna-partners-toc-collection.zip') fail('unsupported', 'Unexpected Cigna TOC collection layout');
        const source = await request(tocUrl, limits.tocBytes);
        const primary = unzipPrimary(source.body, expected, limits);
        const toc = tocFiles(json(primary.bytes), 'Cigna Health Life Insurance Company', now(), limits);
        if (toc.sourceDate !== sourceDate) fail('invalid_source', 'Cigna resolver and TOC dates differ');
        const candidates: IssuerDiscovery['candidates'] = [], unresolved: string[] = [];
        manifest.selection = { requestedNetworks: CIGNA_NETWORKS, observedPrimaryInNetworkPaths: toc.files.size,
          contract: 'Exact current dated primary-TOC paths for the 16 historical Cigna network identities only' };
        for (const network of CIGNA_NETWORKS) {
          const path = collection.origin + '/cost_transparency/mrf/in-network-rates/reporting_month=' + sourceDate.slice(0, 7) + '/' + sourceDate + '_cigna-health-life-insurance-company_' + network + '_in-network-rates.json.gz';
          const found = toc.files.get(path);
          if (found) candidates.push({ url: found, stableKey: 'cigna:' + network }); else unresolved.push(network);
        }
        manifest.unresolved = unresolved.map(network => ({ network, reason: 'No exact current path in the primary Cigna TOC; retirement or replacement unverified' }));
        manifest.zipMember = { name: primary.member, sha256: hash(primary.bytes), bytes: primary.bytes.length, parentSha256: hash(source.body) };
        const tocPath = await saveDerived(gzipSync(primary.bytes), hash(source.body), 'Lossless primary ZIP member as gzip; original ZIP retained');
        result = { tocPath, tocUrl, sourceDate, candidates, scope: 'Cigna primary TOC; ' + candidates.length + '/16 historical networks resolved; unresolved: ' + (unresolved.join(', ') || 'none') + '; whole-plan and national completeness unverified' };
        manifest.status = unresolved.length ? 'partial' : 'complete';
      } else if (issuer === 'mmoh') {
        const page = await request(MMO_PAGE, limits.metadataBytes, 'GET', true);
        if (!/href=["']https?:\/\/www\.medmutual\.com\/mrf["']/.test(page.body.toString())) fail('unsupported', 'Medical Mutual official MRF entrypoint changed');
        const route = await request(MMO_ROUTE, limits.metadataBytes);
        if (!route.location || !/^https:\/\/medmutual\.healthsparq\.com\/healthsparq\/public\/#\/one\/insurerCode=MMO_I&brandCode=MMO&productCode=MRF\/machine-readable-transparency-in-coverage$/.test(route.location)) fail('unsupported', 'Medical Mutual portal identity changed; review current official /mrf redirect');
        // The public portal currently loops on HTTP redirect. Its official issuer/brand identity
        // selects this documented monthly namespace. This is a validated locator, not a claim
        // that a date invented from the clock is source evidence; the TOC date must confirm it.
        const period = now().toISOString().slice(0, 7) + '-01';
        const tocUrl = 'https://mrf.healthsparq.com/mmo-egress.nophi.kyruushsq.com/prd/mrf/MMO_I/MMO/' + period + '/tableOfContents/' + period + '_Medical-Mutual-Of-Ohio_index.json.gz';
        const source = await request(tocUrl, limits.tocBytes);
        const toc = tocFiles(decodeToc(source.body, limits), 'Medical Mutual Of Ohio', now(), limits);
        if (toc.sourceDate !== period) fail('invalid_source', 'Medical Mutual current-month locator and source date differ');
        manifest.resolution = 'Official /mrf issuer/brand redirect plus validated current-month namespace; portal UI body unavailable; no previous-month fallback';
        manifest.selection = { observedInNetworkPaths: toc.files.size, contract: 'All mapped in-network URLs in the validated current-month MMO TOC, including external sources' };
        const candidates: IssuerDiscovery['candidates'] = [], seen = new Map<string, string>();
        for (const [path, signed] of toc.files) {
          const stableKey = 'mmoh:' + path.replace(/\d{4}-\d{2}-\d{2}(?=[/_?]|$)/g, '{date}');
          if (seen.has(stableKey) && seen.get(stableKey) !== path) fail('invalid_source', 'Ambiguous Medical Mutual stable source identity');
          seen.set(stableKey, path); candidates.push({ url: signed, stableKey });
        }
        const tocPath = source.body[0] === 0x1f && source.body[1] === 0x8b ? source.artifact!.path :
          await saveDerived(gzipSync(source.body), hash(source.body), 'Lossless official TOC as gzip');
        result = { tocPath, tocUrl, sourceDate: toc.sourceDate, candidates, scope: 'Medical Mutual validated current-month TOC; all ' + candidates.length + ' mapped in-network URLs enumerated, including external files; file acceptance and whole-plan completeness unverified' };
        manifest.status = 'complete';
      } else if (issuer === 'anthem') {
        const page = await request(ANTHEM_PAGE, limits.metadataBytes, 'GET', true);
        if (!/<script\b[^>]*src=["']script\.js["']/.test(page.body.toString())) fail('unsupported', 'Anthem official script entrypoint changed');
        const script = await request(ANTHEM_SCRIPT, limits.metadataBytes);
        const js = script.body.toString();
        if (!js.includes(EAST1) || !js.includes(EAST2) || !js.includes('_anthem_index.json.gz') || !js.includes('status.json')) fail('unsupported', 'Anthem official TOC resolver changed');
        let bucket = EAST1;
        try { await request(EAST1 + 'status.json', limits.metadataBytes); }
        catch (error) {
          const last = downloads[downloads.length - 1];
          if (error instanceof IssuerDiscoveryError && error.code === 'http' && [403, 404].includes(Number(last?.status))) bucket = EAST2;
          else throw error;
        }
        const tocUrl = bucket + 'anthem/' + now().toISOString().slice(0, 7) + '-01_anthem_index.json.gz';
        const source = await request(tocUrl, 0, 'HEAD');
        manifest.blockedInventory = {
          tocUrl, contentLength: source.response.headers.get('content-length'), sourceDate: null,
          action: 'Archive and validate the full TOC with bounded streaming plan mappings, then add verified rate/reference archives. EIN samples are not canonical reporting_plans.',
          limitation: 'HEAD proves availability/size only. No TOC body or source date was validated.',
        };
        fail('blocked_large_toc', 'Anthem requires full TOC streaming validation; see the archived official discovery and size receipt');
      } else fail('unsupported', 'Unsupported issuer');
      manifest.sourceDate = result!.sourceDate; manifest.scope = result!.scope;
      manifest.candidates = result!.candidates.map(c => ({ stableKey: c.stableKey, url: redacted(c.url), urlSha256: hash(c.url) }));
      return result!;
    } catch (error) {
      const safe = error instanceof IssuerDiscoveryError ? error : new IssuerDiscoveryError('archive', 'Issuer discovery failed; inspect the local source archive');
      safe.manifestPath = manifestPath; manifest.status = safe.code === 'blocked_large_toc' ? 'blocked' : 'failed';
      manifest.error = { code: safe.code, message: safe.message }; throw safe;
    } finally {
      manifest.finishedAt = now().toISOString(); manifest.downloadedBytes = totalBytes;
      checkGuard();
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    }
  };
}

const defaultDiscoverer = createIssuerDiscoverer();
export async function discoverIssuer(issuer: Issuer, archiveDir: string, options?: DiscoveryOptions, fourthOptions?: DiscoveryOptions): Promise<IssuerDiscovery> {
  return defaultDiscoverer(issuer, archiveDir, options, fourthOptions);
}
