import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { atomicJson } from './refresh-runtime';

/** The small parent survives a worker heap abort. Only its own checkpoint may change. */
export async function superviseRefresh(args: string[], statusPath: string): Promise<number> {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  const forward = (signal: NodeJS.Signals) => child.kill(signal);
  const term = () => forward('SIGTERM'), interrupt = () => forward('SIGINT');
  process.on('SIGTERM', term); process.on('SIGINT', interrupt);
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    if (result.code !== 0) {
      const status = JSON.parse(await readFile(statusPath, 'utf8').catch(() => '{}'));
      if (status.pid === child.pid && status.state === 'running') {
        await atomicJson(statusPath, { ...status, state: 'failed', reason: 'worker_exited',
          exitCode: result.code, signal: result.signal, observedAt: new Date().toISOString() });
      }
    }
    return result.code ?? 1;
  } finally { process.off('SIGTERM', term); process.off('SIGINT', interrupt); }
}
