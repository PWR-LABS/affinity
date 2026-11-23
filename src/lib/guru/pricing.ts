const PRICING_URL = 'https://developers.openai.com/api/docs/pricing.md';
const MAX_DOCUMENT_BYTES = 256 * 1024;
const DAY_MS = 86_400_000;
const RETRY_MS = 15 * 60_000;
export const PRICING_REVIEW_MS = 7 * DAY_MS;
export const PRICING_DATE = '2026-11-23';
export const MODEL_IDS = ['gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'] as const;
type Model = typeof MODEL_IDS[number];
export type StandardRates = Readonly<{ input: number; output: number; cached: number; write: number }>;
export type PricingReceipt = {
  source: 'manual-review' | 'official-table';
  checkedAt: string;
  expiresAt: string;
  rates: StandardRates;
};

// Standard short-context USD per million tokens. A live check can renew
// these ceilings, never raise one or admit a model outside this list.
const REVIEWED_RATES: Record<Model, StandardRates> = {
  'gpt-6.1-sol': { input: 2, output: 10, cached: 0.10, write: 2.50 },
  'gpt-6.1-terra': { input: 1, output: 5, cached: 0.05, write: 1.25 },
  'gpt-6-luna': { input: 0.10, output: 0.50, cached: 0.01, write: 0.125 },
};
const HEADER = [
  'Model', 'Short context input', 'Short context output',
  'Short context cached input', 'Short context 30m write', 'Short context 12h write',
];
const tableCells = (line: string) => line.trim().split('|').slice(1, -1).map((cell) => cell.trim());

function usdRate(cell: string | undefined): number {
  if (!cell || !/^\$\d{1,6}(?:\.\d{1,6})?$/.test(cell)) throw Error('Unrecognized Standard price');
  return Number(cell.slice(1));
}

export function reviewedModelsFromPricing(markdown: string): Map<Model, StandardRates> {
  const lines = markdown.split(/\r?\n/);
  const heading = '### Standard pricing data';
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0 || lines.filter((line) => line.trim() === heading).length !== 1) {
    throw Error('Standard pricing section unavailable');
  }
  if (!lines.slice(Math.max(0, start - 25), start).some((line) => line.trim() === 'Prices per 1M tokens.')) {
    throw Error('Unrecognized Standard pricing units');
  }

  const sectionEnd = lines.findIndex((line, index) => index > start && /^#{1,3}\s/.test(line));
  const section = lines.slice(start + 1, sectionEnd < 0 ? undefined : sectionEnd);
  const header = section.findIndex((line) => line.trim().startsWith('|'));
  const columns = header < 0 ? [] : tableCells(section[header]);
  if (!HEADER.every((name, index) => columns[index] === name)) throw Error('Unrecognized Standard pricing table');
  const separator = tableCells(section[header + 1] ?? '');
  if (separator.length !== columns.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw Error('Unrecognized Standard pricing separator');
  }

  const seen = new Set<Model>();
  const allowed = new Map<Model, StandardRates>();
  for (const line of section.slice(header + 2)) {
    if (!line.trim().startsWith('|')) break;
    const [name, input, output, cached, write] = tableCells(line);
    const model = MODEL_IDS.find((id) => id === name);
    if (!model) continue;
    if (seen.has(model)) throw Error('Duplicate Standard model price');
    seen.add(model);
    const ceiling = REVIEWED_RATES[model];
    const rates = { input: usdRate(input), output: usdRate(output), cached: usdRate(cached), write: usdRate(write) };
    if (rates.input <= ceiling.input && rates.output <= ceiling.output &&
        rates.cached <= ceiling.cached && rates.write <= ceiling.write) {
      allowed.set(model, rates);
    }
  }
  if (!seen.size) throw Error('No recognized Standard model prices');
  return allowed;
}

async function fetchPricing(fetcher: typeof fetch): Promise<Map<Model, StandardRates>> {
  const response = await fetcher(PRICING_URL, {
    headers: { accept: 'text/markdown' }, cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(4500),
  });
  if (!response.ok || !/^text\/markdown(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    throw Error('Official pricing document unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let markdown = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOCUMENT_BYTES) throw Error('Official pricing document exceeds size limit');
      markdown += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return reviewedModelsFromPricing(markdown + decoder.decode());
}

/** The public route shares a single in-flight check per process. A network or
 * format failure preserves the last good receipt until its original expiry. */
export function createPublicPricingCheck(fetcher: typeof fetch = fetch, now: () => number = Date.now) {
  let allowed = new Map(MODEL_IDS.map((id) => [id, REVIEWED_RATES[id]]));
  let checkedAt = Date.parse(PRICING_DATE + 'T00:00:00Z');
  let source: 'manual-review' | 'official-table' = 'manual-review';
  let nextCheck = 0;
  let refreshing: Promise<void> | undefined;

  async function refresh() {
    try {
      allowed = await fetchPricing(fetcher);
      checkedAt = now();
      source = 'official-table';
      nextCheck = checkedAt + DAY_MS;
    } catch {
      nextCheck = now() + RETRY_MS;
    }
  }

  return async function assertReviewedPricing(model: Model): Promise<PricingReceipt> {
    if (refreshing || now() >= nextCheck) {
      refreshing ??= refresh().finally(() => { refreshing = undefined; });
      await refreshing;
    }
    const age = now() - checkedAt;
    const rates = allowed.get(model);
    if (!rates || age < 0 || age > PRICING_REVIEW_MS) throw Error('Planner pricing requires review');
    return { source, checkedAt: new Date(checkedAt).toISOString(), expiresAt: new Date(checkedAt + PRICING_REVIEW_MS).toISOString(), rates };
  };
}

const readPublicPricing = createPublicPricingCheck();

export const assertPublicPricing = readPublicPricing;

export async function publicPricingStatus(model: Model) {
  try {
    return { current: true, ...await readPublicPricing(model) };
  } catch {
    return { current: false };
  }
}
