/** Private Mini evaluation only. No provider transport or public activation. */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const BASELINE_SHA256 = '72b1c403baaf9222616652d930a7aeef29f216460eaf7ddfd5f613cae413608e';
export const CAP_MICRO = 5_000_000;
export const EXTENSION_RESERVATION_MICRO = 50_000;
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({
  requestId: z.string().uuid(), phase: z.enum(['held_out', 'interactive']),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), manifestHash: hex, requestHash: hex,
  model: z.literal('gpt-6.1-terra'),
}).strict();
export type ExtensionRequest = z.infer<typeof requestSchema>;
const common = { version: z.literal(1), baselineHash: hex, requestId: z.string().uuid(), at: z.string().datetime() };
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('reserved'), request: requestSchema,
    reservedMicro: z.literal(EXTENSION_RESERVATION_MICRO) }).strict(),
  z.object({ ...common, kind: z.literal('completed'), usageMicro: z.number().int().min(0).max(EXTENSION_RESERVATION_MICRO) }).strict(),
  z.object({ ...common, kind: z.literal('failed'), reason: z.literal('dispatch_or_evidence_failure_review_required') }).strict(),
]);
type Event = z.infer<typeof eventSchema>;

async function append(root: string, event: Event) {
  const file = await open(path.join(root, 'extension-events.jsonl'), 'a', 0o600);
  try { await file.writeFile(JSON.stringify(event) + '\n'); await file.sync(); }
  finally { await file.close(); }
  const directory = await open(root, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function inspect(root: string, baselineHash: string) {
  const bytes = await readFile(path.join(root, 'ledger.json'));
  if (digest(bytes) !== baselineHash) throw Error('Baseline identity changed; review required');
  const baseline = z.object({ capMicro: z.literal(CAP_MICRO), rows: z.array(z.object({
    key: z.string(), state: z.literal('completed'), reservedMicro: z.number().int().positive(),
  }).passthrough()).length(228) }).passthrough().parse(JSON.parse(bytes.toString('utf8')));
  if (new Set(baseline.rows.map(r => r.key)).size !== 228) throw Error('Duplicate baseline identity');
  const baseReserved = baseline.rows.reduce((n, r) => n + r.reservedMicro, 0);
  if (baseReserved !== 4_054_254) throw Error('Unexpected baseline reservation');
  let content = '';
  try { content = await readFile(path.join(root, 'extension-events.jsonl'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (content && !content.endsWith('\n')) throw Error('Partial journal; review required');
  const events = content ? content.slice(0, -1).split('\n').map(line => eventSchema.parse(JSON.parse(line))) : [];
  const requests = new Map<string, { request: ExtensionRequest; state: 'reserved' | 'completed' | 'failed' }>();
  for (const e of events) {
    if (e.baselineHash !== baselineHash) throw Error('Extension baseline mismatch');
    const prior = requests.get(e.requestId);
    if (e.kind === 'reserved') {
      if (prior || e.request.requestId !== e.requestId) throw Error('Duplicate or mismatched extension identity');
      requests.set(e.requestId, { request: e.request, state: 'reserved' });
    } else {
      if (!prior || prior.state !== 'reserved') throw Error('Invalid journal transition');
      prior.state = e.kind;
    }
  }
  if ([...requests.values()].some(r => r.state !== 'completed')) throw Error('Prior uncertain/failed attempt requires review');
  const totalReserved = baseReserved + requests.size * EXTENSION_RESERVATION_MICRO;
  if (totalReserved > CAP_MICRO) throw Error('Journal exceeds aggregate cap');
  return { requests, totalReserved };
}

/** Trusted local caller supplies pinned metadata; never accept these controls from
 * a browser. baselineHash override exists for isolated synthetic filesystem tests.
 * dispatch must validate model/status/usage and persist its review evidence before
 * returning. The same original publisher.lock is held through the whole dispatch.
 * No stale-lock cleanup, reservation release, retry, journal rewrite or baseline write.
 */
export async function withExtensionReservation<T>(options: {
  root: string; request: ExtensionRequest; baselineHash?: string;
  dispatch: () => Promise<{ value: T; usageMicro: number }>;
}): Promise<T> {
  const request = requestSchema.parse(options.request);
  const baselineHash = hex.parse(options.baselineHash ?? BASELINE_SHA256);
  const lock = path.join(options.root, 'publisher.lock');
  await mkdir(lock, { mode: 0o700 }); // Fail immediately if any publisher owns it.
  try {
    const state = await inspect(options.root, baselineHash);
    if (state.requests.has(request.requestId)) throw Error('Request already reserved; no repeat dispatch');
    const phaseCount = [...state.requests.values()].filter(r => r.request.phase === request.phase).length;
    if (phaseCount >= (request.phase === 'held_out' ? 8 : 10)) throw Error('Evaluation phase allowance exhausted');
    if (state.totalReserved + EXTENSION_RESERVATION_MICRO > CAP_MICRO) throw Error('Aggregate benchmark cap exhausted');
    const base = { version: 1 as const, baselineHash, requestId: request.requestId };
    await append(options.root, { ...base, at: new Date().toISOString(), kind: 'reserved', request,
      reservedMicro: EXTENSION_RESERVATION_MICRO });
    try {
      const result = await options.dispatch();
      if (!Number.isSafeInteger(result.usageMicro) || result.usageMicro < 0 || result.usageMicro > EXTENSION_RESERVATION_MICRO)
        throw Error('Invalid usage evidence');
      await append(options.root, { ...base, at: new Date().toISOString(), kind: 'completed', usageMicro: result.usageMicro });
      return result.value;
    } catch {
      await append(options.root, { ...base, at: new Date().toISOString(), kind: 'failed', reason: 'dispatch_or_evidence_failure_review_required' });
      throw Error('Dispatch or evidence failure; reservation retained, review required');
    }
  } finally { await rmdir(lock); }
}
