import { join } from 'node:path';
import { stateRoot } from './lib/refresh-runtime';
import { superviseRefresh } from './lib/refresh-supervisor';

superviseRefresh(['--max-old-space-size=1024', '--import', 'tsx', 'scripts/tic-refresh-cycle.ts', ...process.argv.slice(2)], join(stateRoot, 'status.json'), { preflightMs: 60_000 })
  .then(code => { process.exitCode = code; })
  .catch(() => { console.error('Refresh supervisor failed; inspect protected local checkpoint.'); process.exitCode = 1; });
