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
  requestId: z.string().uuid(), phase: z.enum(['held_out', 'repair_probe', 'interactive']),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), manifestHash: hex, requestHash: hex,
  model: z.literal('gpt-6.1-terra'),
}).strict();
export type ExtensionRequest = z.infer<typeof requestSchema>;
const reviewSchema = z.object({
  requestId: z.string().uuid(), failedEventSha256: hex,
  repairedSourceCommit: z.string().regex(/^[a-f0-9]{40}$/), repairedSourceSha256: hex,
  reviewEvidenceSha256: hex,
  reason: z.literal('validated_response_schema_mismatch_repaired'),
}).strict();
export type FailedAttemptReview = z.infer<typeof reviewSchema>;
const common = { version: z.literal(1), baselineHash: hex, requestId: z.string().uuid(), at: z.string().datetime() };
const eventSchema = z.discriminatedUnion('kind', [
  reviewSchema.extend({ version: z.literal(3), baselineHash: hex, at: z.string().datetime(),
    kind: z.literal('failed_attempt_reviewed') }).strict(),
  z.object({ version: z.literal(2), baselineHash: hex, at: z.string().datetime(),
    kind: z.literal('allocation_amended'), allocationId: z.literal('conversation-repair-2-interactive-8/v1') }).strict(),
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
  const events = content ? content.slice(0, -1).split('\n').map(line => ({
    event: eventSchema.parse(JSON.parse(line)), sha256: digest(line + '\n'),
  })) : [];
  const requests = new Map<string, { request: ExtensionRequest; state: 'reserved' | 'completed' | 'failed';
    failedEventSha256?: string; review?: FailedAttemptReview }>();
  const unresolved = () => [...requests.values()].some(r => r.state === 'reserved' || (r.state === 'failed' && !r.review));
  let requiredSourceCommit: string | undefined;
  let amended = false;
  let limits = { held_out: 8, repair_probe: 0, interactive: 10 };
  for (const { event: e, sha256 } of events) {
    if (e.baselineHash !== baselineHash) throw Error('Extension baseline mismatch');
    if (e.kind === 'allocation_amended') {
      if (amended || [...requests.values()].some(r => r.state !== 'completed') ||
        [...requests.values()].filter(r => r.request.phase === 'interactive').length > 8) throw Error('Incompatible allocation amendment');
      amended = true; limits = { held_out: 8, repair_probe: 2, interactive: 8 }; continue;
    }
    const prior = requests.get(e.requestId);
    if (e.kind === 'failed_attempt_reviewed') {
      if (!prior || prior.state !== 'failed' || prior.review || e.failedEventSha256 !== prior.failedEventSha256 ||
        e.repairedSourceCommit === prior.request.sourceCommit) throw Error('Invalid failed-attempt review binding');
      // The terminal failure remains a failure. Review only admits future IDs
      // against this explicitly reviewed source, without refunding its slot.
      prior.review = reviewSchema.parse({ requestId: e.requestId, failedEventSha256: e.failedEventSha256,
        repairedSourceCommit: e.repairedSourceCommit, repairedSourceSha256: e.repairedSourceSha256,
        reviewEvidenceSha256: e.reviewEvidenceSha256, reason: e.reason });
      requiredSourceCommit = e.repairedSourceCommit;
      continue;
    }
    if (e.kind === 'reserved') {
      if (prior || e.request.requestId !== e.requestId) throw Error('Duplicate or mismatched extension identity');
      if (unresolved()) throw Error('Journal dispatch preceded required review');
      if (requiredSourceCommit && e.request.sourceCommit !== requiredSourceCommit) throw Error('Request source differs from reviewed repair');
      if ([...requests.values()].filter(r => r.request.phase === e.request.phase).length >= limits[e.request.phase]) throw Error('Journal exceeds phase allowance');
      requests.set(e.requestId, { request: e.request, state: 'reserved' });
    } else {
      if (!prior || prior.state !== 'reserved') throw Error('Invalid journal transition');
      prior.state = e.kind;
      if (e.kind === 'failed') prior.failedEventSha256 = sha256;
    }
  }
  const totalReserved = baseReserved + requests.size * EXTENSION_RESERVATION_MICRO;
  if (totalReserved > CAP_MICRO) throw Error('Journal exceeds aggregate cap');
  return { requests, totalReserved, limits, amended, unresolved: unresolved(), requiredSourceCommit };
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
    if (state.unresolved) throw Error('Prior uncertain/failed attempt requires review');
    if (state.requiredSourceCommit && request.sourceCommit !== state.requiredSourceCommit) throw Error('Request source differs from reviewed repair');
    const phaseCount = [...state.requests.values()].filter(r => r.request.phase === request.phase).length;
    if (phaseCount >= state.limits[request.phase]) throw Error('Evaluation phase allowance exhausted');
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

/** Explicit compatible redistribution, never a reset. No provider dispatch.
 * Existing events remain byte-for-byte intact and count against the same cap. */
export async function amendRepairAllocation(root: string, baselineHash = BASELINE_SHA256) {
  hex.parse(baselineHash);
  const lock = path.join(root, 'publisher.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    const state = await inspect(root, baselineHash);
    if (state.unresolved) throw Error('Prior uncertain/failed attempt requires review');
    if ([...state.requests.values()].some(r => r.state !== 'completed')) throw Error('Allocation cannot change after failed attempt');
    if (state.amended) throw Error('Allocation already amended');
    if ([...state.requests.values()].filter(r => r.request.phase === 'interactive').length > 8) throw Error('Existing reservations cannot be reduced');
    await append(root, { version: 2, baselineHash, at: new Date().toISOString(), kind: 'allocation_amended', allocationId: 'conversation-repair-2-interactive-8/v1' });
    return { totalReservedMicro: state.totalReserved, limits: { held_out: 8, repair_probe: 2, interactive: 8 } };
  } finally { await rmdir(lock); }
}

/** Trusted local review only, never a browser endpoint or automatic recovery.
 * The caller must independently establish valid provider completion/usage and
 * the repaired source plus review evidence. Hashes bind that supplied evidence;
 * this helper does not authenticate a reviewer or inspect private responses.
 * failedEventSha256 hashes the original failed JSONL line INCLUDING its newline.
 * The original failure and reservation stay intact. Pending attempts cannot be
 * reviewed, and duplicate reviews/old request IDs cannot be dispatched again.
 */
export async function reviewFailedAttempt(options: {
  root: string; review: FailedAttemptReview; baselineHash?: string;
}) {
  const review = reviewSchema.parse(options.review);
  const baselineHash = hex.parse(options.baselineHash ?? BASELINE_SHA256);
  const lock = path.join(options.root, 'publisher.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    const state = await inspect(options.root, baselineHash);
    const prior = state.requests.get(review.requestId);
    if (!prior || prior.state !== 'failed' || prior.review || prior.failedEventSha256 !== review.failedEventSha256 ||
      review.repairedSourceCommit === prior.request.sourceCommit) throw Error('Invalid failed-attempt review binding');
    if ([...state.requests.values()].some(r => r.state === 'reserved')) throw Error('Pending attempt cannot be reviewed');
    await append(options.root, { ...review, version: 3, baselineHash, at: new Date().toISOString(), kind: 'failed_attempt_reviewed' });
    return { totalReservedMicro: state.totalReserved, remainingInPhase: state.limits[prior.request.phase] -
      [...state.requests.values()].filter(r => r.request.phase === prior.request.phase).length,
      requiredSourceCommit: review.repairedSourceCommit, failedReservationRetained: true };
  } finally { await rmdir(lock); }
}
