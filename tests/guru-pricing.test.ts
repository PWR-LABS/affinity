import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchModel, RESERVATION_MICRO, TERRA_RESERVATION_MICRO } from '@/lib/guru/planner';
import { createPublicPricingCheck, MODEL_IDS, PRICING_DATE } from '@/lib/guru/pricing';

const DAY = 86_400_000;
const PIN = Date.parse(PRICING_DATE + 'T00:00:00Z');

const standardTable = `
Prices per 1M tokens.

### Standard pricing data

| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write |
| ----- | ------------------- | -------------------- | -------------------------- | ----------------------- | ----------------------- |
| gpt-6.1-sol | $2.00 | $10.00 | $0.10 | $2.50 | $3.00 |
| gpt-6.1-terra | $1.00 | $5.00 | $0.05 | $1.25 | $1.50 |
| gpt-6-luna | $0.10 | $0.50 | $0.01 | $0.125 | $0.15 |
`;

function published(markdown = standardTable) {
  return new Response(markdown, { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
}

test('public guru renews past the original cutoff using one credential-free Standard pricing request', async () => {
  let requests = 0;
  let time = PIN + 8 * DAY;
  let document = standardTable;
  const assertPricing = createPublicPricingCheck(async (url, options) => {
    requests++;
    assert.equal(url, 'https://developers.openai.com/api/docs/pricing.md');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('authorization'), null);
    return published(document);
  }, () => time);

  const receipts = await Promise.all(MODEL_IDS.map(assertPricing));
  assert.ok(receipts.every((receipt) => receipt.source === 'official-table' && receipt.checkedAt === new Date(time).toISOString()));
  time += DAY - 1;
  await assertPricing('gpt-6.1-terra');
  assert.equal(requests, 1);
  time += 1;
  document = standardTable.replace('| gpt-6.1-terra | $1.00', '| gpt-6.1-terra | $0.75');
  assert.equal((await assertPricing('gpt-6.1-terra')).rates.input, 0.75);
  assert.equal(requests, 2);
});

test('document failures preserve the last good check only through its original expiry', async () => {
  let time = PIN + 8 * DAY;
  let document = standardTable;
  const assertPricing = createPublicPricingCheck(async () => published(document), () => time);

  await assertPricing('gpt-6.1-terra');
  document = standardTable.replace('### Standard pricing data', '### Batch pricing data');
  time += DAY;
  await assertPricing('gpt-6.1-terra');
  time += 7 * DAY;
  await assert.rejects(assertPricing('gpt-6.1-terra'), /pricing requires review/);

  document = standardTable;
  time += 15 * 60_000;
  await assertPricing('gpt-6.1-terra');
});

test('an increased or removed Standard rate prevents dispatch before reservation', async () => {
  let time = PIN + 8 * DAY;
  let reservations = 0;
  let dispatches = 0;
  let document = standardTable;
  const assertPricing = createPublicPricingCheck(async () => published(document), () => time);
  await assertPricing('gpt-6.1-terra');

  time += DAY;
  document = standardTable.replace('$1.25 | $1.50', '$1.26 | $1.50')
    .replace(/^\| gpt-6-luna.*\n/m, '');
  await assertPricing('gpt-6.1-sol');
  for (const model of ['gpt-6.1-terra', 'gpt-6-luna']) {
    await assert.rejects(dispatchModel({
      model,
      body: { model, max_output_tokens: 1000 },
      key: 'test-key',
      reserve: async () => { reservations++; },
      fetcher: async () => { dispatches++; return new Response('{}'); },
      checkPricing: assertPricing,
    }), /pricing requires review/);
  }
  assert.equal(reservations, 0);
  assert.equal(dispatches, 0);
});

test('public Terra uses the smaller reservation before a full-size turn dispatches', async () => {
  const checkPricing = createPublicPricingCheck(async () => published(), () => PIN + 8 * DAY);
  for (const [model, expected, priceCheck] of [
    ['gpt-6.1-terra', TERRA_RESERVATION_MICRO, checkPricing],
    ['gpt-6.1-sol', RESERVATION_MICRO, checkPricing],
    ['gpt-6.1-terra', RESERVATION_MICRO, undefined],
  ] as const) {
    const events: Array<string | number> = [];
    const body = { model, max_output_tokens: 1000, input: 'x'.repeat(11_800) };
    await dispatchModel({
      model, body, key: 'synthetic', now: new Date(PIN), checkPricing: priceCheck,
      reserve: async (amount) => { events.push(amount); },
      fetcher: async () => { events.push('dispatched'); return Response.json({ model }); },
    });
    assert.deepEqual(events, [expected, 'dispatched']);
  }
});

test('a priced turn that would exceed the smaller reservation is refused before reserving', async () => {
  const check = createPublicPricingCheck(async () => published(), () => PIN + 8 * DAY);
  const model = 'gpt-6.1-terra';
  await assert.rejects(dispatchModel({
    model, body: { model, max_output_tokens: 1000 }, key: 'synthetic',
    checkPricing: async (id) => {
      const receipt = await check(id);
      return { ...receipt, rates: { ...receipt.rates, output: 30 } };
    },
    reserve: async () => assert.fail('must not reserve'),
    fetcher: async () => assert.fail('must not dispatch'),
  }), /exceeds its upper reservation/);
});
