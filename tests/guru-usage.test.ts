import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { conversationTurn } from '@/lib/guru/conversation';
import { validUsageProof } from '@/lib/guru/readiness';
import { meteredUsage } from '@/lib/guru/usage';
import { initialContext } from '@/lib/guru/workspace';

const model = 'gpt-6.1-terra';
const rates = { input: 1, output: 5, cached: 0.05, write: 1.25 };
const usage = {
  input_tokens: 2200,
  input_tokens_details: {
    cached_tokens: 1000,
    cache_write_tokens: 900,
    cache_write_tokens_details: { ttl_30m_tokens: 900, ttl_12h_tokens: 0 },
  },
  output_tokens: 400,
  output_tokens_details: { reasoning_tokens: 80 },
};

test('meters billed reads and writes once and counts reasoning within output', () => {
  assert.deepEqual(meteredUsage(model, { ...usage, unrelated: 'not accounting data' }, rates, 'default'), {
    model, inputTokens: 2200, cachedInputTokens: 1000, cacheWriteInputTokens: 900, outputTokens: 400,
    reasoningTokens: 80, estimatedCostPicoUsd: BigInt(3_475_000_000),
  });
  const luna = meteredUsage('gpt-6-luna', {
    input_tokens: 1, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1 }, output_tokens: 0,
  }, { input: 0.10, output: 0.50, cached: 0.01, write: 0.125 }, 'default');
  assert.equal(luna?.estimatedCostPicoUsd, BigInt(125_000));
});

test('preserves actual totals when the cost cannot be verified', () => {
  assert.equal(meteredUsage(model, null, rates, 'default'), null);
  const withoutCache = meteredUsage(model, { input_tokens: 2200, output_tokens: 400 }, rates, 'default');
  assert.equal(withoutCache?.inputTokens, 2200);
  assert.equal(withoutCache?.estimatedCostPicoUsd, null);
  assert.equal(meteredUsage(model, usage, rates, 'scale')?.estimatedCostPicoUsd, null);
  assert.equal(meteredUsage(model, {
    ...usage,
    input_tokens_details: {
      cached_tokens: 1000,
      cache_write_tokens: 900,
      cache_write_tokens_details: { ttl_30m_tokens: 800, ttl_12h_tokens: 100 },
    },
  }, rates, 'default')?.estimatedCostPicoUsd, null);
});

test('records metered usage before an incomplete conversation falls back', async () => {
  const events: unknown[] = [];
  await assert.rejects(conversationTurn({
    model, history: [{ role: 'you', text: 'Fixture chat', superseded: false }],
    context: initialContext(2027), evidence: [], key: 'synthetic',
    checkPricing: async () => ({
      source: 'official-table', checkedAt: '2026-11-23T20:00:00Z', expiresAt: '2026-11-30T20:00:00Z',
      rates: { ...rates, input: 0.5 },
    }),
    reserve: async () => { events.push('reserved'); },
    fetcher: async () => Response.json({ model, status: 'incomplete', usage, output: ['Fixture reply'] }),
    recordUsage: async (receipt) => { events.push(receipt); },
  }), /Conversation incomplete/);
  assert.deepEqual(events, ['reserved', {
    model, inputTokens: 2200, cachedInputTokens: 1000, cacheWriteInputTokens: 900, outputTokens: 400,
    reasoningTokens: 80, estimatedCostPicoUsd: BigInt(3_325_000_000),
  }]);
});

test('usage proof is scoped to an exact UTC month and separate from readiness', async () => {
  const now = Date.now();
  const secret = 'ab'.repeat(32);
  const signed = (domain: string) => now + '.' + createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${domain}:${now}`).digest('hex');
  assert.equal(validUsageProof(signed('guru-usage:2026-11'), secret, '2026-11', now), true);
  assert.equal(validUsageProof(signed('guru-usage:2026-11'), secret, '2026-12', now), false);
  assert.equal(validUsageProof(signed('guru-readiness'), secret, '2026-11', now), false);
  const { GET } = await import('@/app/api/guru/usage/route');
  const unauthorized = await GET(new Request('https://affinity.example/api/guru/usage?month=2026-11'));
  assert.equal(unauthorized.status, 404);
  assert.equal(await unauthorized.text(), '');
});
