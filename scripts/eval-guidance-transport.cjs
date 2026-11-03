/** Bounded public-source transport diagnostic. No credentials or raw bodies are retained. */
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const urls = [
  'https://www.medicaid.gov/renew-info/NY',
  'https://www.medicaid.gov/federal-policy-guidance',
  'https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip',
];
const userAgent = 'affinity-source-watch/1.0 (+https://github.com/PWR-LABS/affinity)';
const accept = 'text/html,application/pdf';
const pause = () => new Promise(resolve => setTimeout(resolve, 1200));
async function main() {
  const observations = [];
  for (const url of urls) {
    for (const transport of ['node-original', 'node-identified', 'node-identified-default-cache', 'curl-identified']) {
      await pause();
      const record = { url, transport, observedAt: new Date().toISOString(), status: 'unavailable' };
      try {
        let bytes, httpStatus, contentType;
        if (transport === 'curl-identified') {
          const output = execFileSync('curl', ['--silent', '--show-error', '--location', '--max-time', '15', '--user-agent', userAgent, '--header', `Accept: ${accept}`, '--write-out', '\n%{http_code}\n%{content_type}', url], { maxBuffer: 3 * 1024 * 1024 });
          const end = output.lastIndexOf(10), code = output.lastIndexOf(10, end - 1);
          bytes = output.subarray(0, code); httpStatus = Number(output.subarray(code + 1, end).toString()); contentType = output.subarray(end + 1).toString();
        } else {
          const response = await fetch(url, { signal: AbortSignal.timeout(15000),
            ...(transport.endsWith('default-cache') ? {} : { cache: 'no-store' }),
            headers: { accept, ...(transport === 'node-original' ? {} : { 'user-agent': userAgent }) } });
          bytes = Buffer.from(await response.arrayBuffer()); httpStatus = response.status; contentType = response.headers.get('content-type');
        }
        const html = bytes.toString();
        Object.assign(record, { status: 'observed', httpStatus, contentType, bytes: bytes.length,
          hasMain: /<main\b/i.test(html), accessDenied: /access denied|request rejected|forbidden/i.test(html),
          rawSha256: createHash('sha256').update(bytes).digest('hex') });
      } catch { /* Keep failures explicit without emitting response bodies or exception text. */ }
      observations.push(record);
      console.log(JSON.stringify(record));
    }
  }
  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/guidance-transport.json', JSON.stringify({ observedAt: new Date().toISOString(), node: process.version, observations }, null, 2) + '\n');
}
main().catch(() => { console.error('guidance_transport_diagnostic_failed'); process.exitCode = 1; });
