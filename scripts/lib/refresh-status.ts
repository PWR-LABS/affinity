import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecordValue = Record<string, unknown>;
async function readObject(path: string, limit: number): Promise<RecordValue> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw Error('invalid_checkpoint_file');
    const value = JSON.parse(await file.readFile('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_checkpoint_object');
    return value;
  } finally { await file.close(); }
}
const positivePid = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
function validOutcome(value: RecordValue, id: string) {
  return value.version === 1 && value.supervisionId === id && positivePid(value.pid) && positivePid(value.supervisorPid) &&
    ['failed', 'deferred'].includes(String(value.state)) &&
    ['worker_exited', 'worker_deadline', 'worker_interrupted', 'storage_preflight_timeout'].includes(String(value.reason)) &&
    ['updated', 'not_owned', 'deferred'].includes(String(value.checkpointUpdate)) &&
    typeof value.terminationPending === 'boolean' &&
    typeof value.startedAt === 'string' && Number.isFinite(Date.parse(value.startedAt)) &&
    typeof value.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) &&
    Number.isSafeInteger(value.elapsedMs) && Number(value.elapsedMs) >= 0 &&
    (value.exitCode === null || Number.isSafeInteger(value.exitCode)) &&
    (value.signal === null || (typeof value.signal === 'string' && /^SIG[A-Z0-9]+$/.test(value.signal)));
}
/** Read-only interpretation. A status snapshot alone never proves process liveness.
 * Separate-attempt outcomes are visible but cannot supersede the current checkpoint. */
export async function readRefreshStatus(statusPath: string) {
  let checkpoint: RecordValue | null = null, checkpointError: string | undefined;
  try { checkpoint = await readObject(statusPath, 2_000_000); }
  catch (error) { checkpointError = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'checkpoint_missing' : 'checkpoint_unreadable'; }
  const directory = dirname(statusPath), prefix = basename(statusPath) + '.', suffix = '.supervision.json';
  let names: string[];
  try { names = (await readdir(directory)).filter(name => name.startsWith(prefix) && name.endsWith(suffix)); }
  catch { names = []; checkpointError ??= 'supervision_directory_unreadable'; }
  if (names.length > 1000) throw Error('supervision_inventory_limit');
  const outcomes: RecordValue[] = [], invalid: string[] = [];
  for (const name of names) {
    const id = name.slice(prefix.length, -suffix.length);
    if (!uuid.test(id)) { invalid.push(name); continue; }
    try { const value = await readObject(join(directory, name), 65_536); if (!validOutcome(value, id)) throw Error(); outcomes.push(value); }
    catch { invalid.push(name); }
  }
  const id = checkpoint?.supervisionId;
  const identityKnown = typeof id === 'string' && uuid.test(id) && positivePid(checkpoint?.pid);
  const exact = identityKnown ? outcomes.find(value => value.supervisionId === id && value.pid === checkpoint!.pid) : undefined;
  const wrongPid = identityKnown && outcomes.some(value => value.supervisionId === id && value.pid !== checkpoint!.pid);
  const invalidMatching = identityKnown && invalid.includes(prefix + id + suffix);
  const associationError = wrongPid ? 'supervision_pid_mismatch' : invalidMatching ? 'supervision_unreadable' : undefined;
  // Preserve explicit worker failures/completion and their original reason. A
  // matching terminal supervisor event overrides only a stale running snapshot.
  const effectiveState = checkpointError || associationError ? 'unknown' :
    checkpoint?.state === 'running' && exact ? exact.state : checkpoint?.state ?? 'unknown';
  const separate = outcomes.filter(value => value !== exact).sort((a, b) => Date.parse(String(b.observedAt)) - Date.parse(String(a.observedAt)));
  return { checkpoint, effectiveState, processOutcome: exact ? 'interrupted' : 'unverified',
    diagnostic: checkpointError ?? associationError ?? (!identityKnown ? 'checkpoint_identity_unknown' : undefined),
    supervision: exact ?? null, otherSupervisions: separate.slice(0, 10), otherSupervisionCount: separate.length,
    invalidSupervisionCount: invalid.length, processLivenessVerified: false, storageHealthVerified: false, databaseOutcomeVerified: false };
}
