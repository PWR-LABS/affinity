import { join } from 'node:path';
import { stateRoot } from './lib/refresh-runtime';
import { readRefreshStatus } from './lib/refresh-status';

readRefreshStatus(join(stateRoot, 'status.json')).then(result => {
  const { checkpoint, ...outcome } = result;
  const rows = Array.isArray(checkpoint?.results) ? checkpoint.results : [];
  const resultCounts: Record<string, number> = {};
  for (const row of rows) if (row && typeof row.state === 'string') resultCounts[row.state] = (resultCounts[row.state] ?? 0) + 1;
  const summary = checkpoint ? Object.fromEntries(['supervisionId', 'pid', 'state', 'reason', 'observedAt', 'current', 'lastPublishedAt', 'latestSources'].filter(key => key in checkpoint).map(key => [key, checkpoint[key]])) : null;
  console.log(JSON.stringify({ ...outcome, checkpoint: summary, resultCounts, recentResults: rows.slice(-3) }, null, 2));
}).catch(() => { console.error('Refresh status unavailable; inspect protected internal checkpoints.'); process.exitCode = 1; });
