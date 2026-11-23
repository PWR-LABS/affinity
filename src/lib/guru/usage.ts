import { z } from 'zod';
import type { MODEL_IDS, StandardRates } from './pricing';

const count = z.number().int().min(0).max(2_147_483_647);
const responseUsage = z.object({
  input_tokens: count,
  input_tokens_details: z.object({
    cached_tokens: count.nullish(),
    cache_write_tokens: count.nullish(),
    cache_write_tokens_details: z.object({
      ttl_30m_tokens: count,
      ttl_12h_tokens: count,
    }).nullish(),
  }).nullish(),
  output_tokens: count,
  output_tokens_details: z.object({ reasoning_tokens: count.nullish() }).nullish(),
});

export type AttemptUsage = {
  model: typeof MODEL_IDS[number];
  inputTokens: number;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number;
  reasoningTokens: number | null;
  estimatedCostPicoUsd: bigint | null;
};

// Responses reports reads and writes as nonoverlapping subsets of input. The
// output total already includes reasoning. Guru requests Standard, default 30m.
export function meteredUsage(
  model: AttemptUsage['model'],
  value: unknown,
  rates: StandardRates,
  serviceTier: unknown,
): AttemptUsage | null {
  const parsed = responseUsage.safeParse(value);
  if (!parsed.success) return null;
  const { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: input, output_tokens_details: output } = parsed.data;
  const split = input?.cache_write_tokens_details;
  const splitWrites = split ? split.ttl_30m_tokens + split.ttl_12h_tokens : null;
  const reportedWrites = input?.cache_write_tokens ?? splitWrites;
  const cacheWriteInputTokens = reportedWrites !== null && reportedWrites <= inputTokens ? reportedWrites : null;
  const cachedInputTokens = input?.cached_tokens ?? null;
  const reasoningTokens = output?.reasoning_tokens ?? null;
  let estimatedCostPicoUsd: bigint | null = null;

  if (cachedInputTokens !== null && cacheWriteInputTokens !== null &&
      (splitWrites === null || splitWrites === cacheWriteInputTokens) && !split?.ttl_12h_tokens &&
      (serviceTier == null || serviceTier === 'default')) {
    const uncached = inputTokens - cachedInputTokens - cacheWriteInputTokens;
    if (uncached >= 0) {
      // Prices have up to six decimals in USD per million. Pico-USD preserves
      // that precision per token and supports exact totals across attempts.
      const price = (tokens: number, usdPerMillion: number) => BigInt(tokens) * BigInt(Math.round(usdPerMillion * 1_000_000));
      estimatedCostPicoUsd = price(uncached, rates.input) + price(cachedInputTokens, rates.cached) +
        price(cacheWriteInputTokens, rates.write) + price(outputTokens, rates.output);
    }
  }

  return {
    model, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens,
    reasoningTokens: reasoningTokens !== null && reasoningTokens <= outputTokens ? reasoningTokens : null,
    estimatedCostPicoUsd,
  };
}
