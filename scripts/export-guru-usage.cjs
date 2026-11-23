const { createHmac } = require('node:crypto');

async function main() {
  const month = process.argv[2] ?? new Date().toISOString().slice(0, 7);
  const secret = process.env.AFFINITY_GURU_VISITOR_SECRET;
  if (process.argv.length > 3 || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) {
    throw Error('Usage: node scripts/export-guru-usage.cjs [YYYY-MM]');
  }
  if (!secret || !/^(?:[0-9a-f]{2}){32,}$/i.test(secret)) {
    throw Error('Load the existing operator secret using the protected runtime configuration.');
  }
  const now = Date.now();
  const signature = createHmac('sha256', Buffer.from(secret, 'hex')).update(`guru-usage:${month}:${now}`).digest('hex');
  const response = await fetch(`https://affinity.pwr-labs.ai/api/guru/usage?month=${month}`, {
    headers: { 'x-affinity-usage-proof': `${now}.${signature}` },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('text/csv;')) {
    throw Error(`Usage export unavailable (HTTP ${response.status}).`);
  }
  process.stdout.write(await response.text());
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
