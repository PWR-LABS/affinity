import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, Deferred, lockRunMutex } from './refresh-runtime';
import { REFRESH_POLICY } from './refresh-policy';

type Options = { deadlineMs?: number; graceMs?: number; preflightMs?: number };
/** Parent timers remain live even when the worker blocks in synchronous SSD I/O. */
export async function superviseRefresh(args: string[], statusPath: string, options: Options = {}): Promise<number> {
  const deadlineMs = options.deadlineMs ?? REFRESH_POLICY.cycleMs;
  const graceMs = options.graceMs ?? 10_000;
  for (const value of [deadlineMs, graceMs, ...(options.preflightMs === undefined ? [] : [options.preflightMs])]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw Error('Invalid supervisor deadline');
  }
  // A dedicated process group includes local tar/SQLite helper children. Never
  // signal an unrelated process or delete a lock while a stuck worker survives.
  const grouped = process.platform !== 'win32';
  const supervisionId = randomUUID(), startedAt = new Date().toISOString(), started = performance.now();
  const child = spawn(process.execPath, args, { detached: grouped, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    env: { ...process.env, AFFINITY_REFRESH_SUPERVISION_ID: supervisionId } });
  let reason: string | undefined, stoppedCode = 124, exited = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  let preflight: ReturnType<typeof setTimeout> | undefined;
  let finish!: (result: { code: number | null; signal: NodeJS.Signals | null; pending?: boolean }) => void;
  const signal = (value: NodeJS.Signals) => {
    if (!child.pid) return;
    try { if (grouped) process.kill(-child.pid, value); else child.kill(value); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  const stop = (why: string, code = 124) => {
    if (reason || exited) return;
    reason = why; stoppedCode = code;
    signal('SIGTERM');
    grace = setTimeout(() => {
      signal('SIGKILL');
      // A kernel-blocked child may not emit exit until the disk recovers. Return
      // a bounded result, retaining its PID sidecar/OS mutex for future exclusion.
      finish({ code: null, signal: 'SIGKILL', pending: !exited });
    }, graceMs);
  };
  const term = () => stop('worker_interrupted', 143), interrupt = () => stop('worker_interrupted', 130);
  process.on('SIGTERM', term); process.on('SIGINT', interrupt);
  const deadline = setTimeout(() => stop('worker_deadline'), deadlineMs);
  if (options.preflightMs !== undefined) preflight = setTimeout(() => stop('storage_preflight_timeout'), options.preflightMs);
  child.on('message', message => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'refresh_storage_ready') clearTimeout(preflight);
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; pending?: boolean }>((resolve, reject) => {
      finish = resolve;
      child.once('error', reject);
      child.once('exit', (code, exitSignal) => {
        exited = true;
        // A crash/OOM can strand the same helpers as a deadline interruption.
        // Stop them before returning; this group belongs exclusively to this child.
        if (reason || code !== 0) signal('SIGKILL');
        resolve({ code, signal: exitSignal });
      });
    });
    if (result.code !== 0 || reason) {
      const outcome = { version: 1, supervisionId, pid: child.pid, supervisorPid: process.pid, startedAt,
        elapsedMs: Math.floor(performance.now() - started), reason: reason ?? 'worker_exited',
        exitCode: result.code, signal: result.signal,
        state: reason ? 'deferred' : 'failed',
        terminationPending: result.pending ?? false, observedAt: new Date().toISOString() };
      let unlock: (() => void) | undefined;
      let checkpointUpdate: 'updated' | 'not_owned' | 'deferred' = 'not_owned';
      let checkpointReason: string | undefined;
      try { unlock = await lockRunMutex(dirname(statusPath)); }
      catch (error) {
        if (!(error instanceof Deferred)) throw error;
        // The worker may still be in kernel I/O, or another publisher may have
        // taken over. Preserve its checkpoint and both lock files. A separate
        // small receipt keeps the timeout/termination outcome explicit.
        checkpointUpdate = 'deferred'; checkpointReason = error.message;
      }
      if (unlock) try {
        const status = JSON.parse(await readFile(statusPath, 'utf8').catch(() => '{}'));
        if (status.pid === child.pid && status.supervisionId === supervisionId && status.state === 'running') {
          await atomicJson(statusPath, { ...status, ...outcome });
          checkpointUpdate = 'updated';
        }
      } finally { unlock(); }
      await atomicJson(`${statusPath}.${supervisionId}.supervision.json`, { ...outcome, checkpointUpdate, checkpointReason });
    }
    return reason ? stoppedCode : result.code ?? 1;
  } finally {
    clearTimeout(deadline); clearTimeout(grace); clearTimeout(preflight);
    process.off('SIGTERM', term); process.off('SIGINT', interrupt);
    if (child.connected) child.disconnect();
    child.unref();
  }
}
