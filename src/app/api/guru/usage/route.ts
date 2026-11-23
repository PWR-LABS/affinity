import { NextResponse } from 'next/server';
import { validUsageProof } from '@/lib/guru/readiness';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asUsd(picoUsd: bigint | null): string {
  if (picoUsd === null) return '';
  const digits = picoUsd.toString().padStart(13, '0');
  return digits.slice(0, -12) + '.' + digits.slice(-12);
}

export async function GET(req: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const month = new URL(req.url).searchParams.get('month') ?? '';
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
      !validUsageProof(req.headers.get('x-affinity-usage-proof'), process.env.AFFINITY_GURU_VISITOR_SECRET, month)) {
    return new NextResponse(null, { status: 404, headers });
  }

  const start = new Date(month + '-01T00:00:00Z');
  const end = new Date(start);
  end.setUTCMonth(start.getUTCMonth() + 1);
  try {
    const rows = await prisma.guruReservation.findMany({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        createdAt: true,
        usageModel: true,
        usageInputTokens: true,
        usageCachedInputTokens: true,
        usageCacheWriteInputTokens: true,
        usageOutputTokens: true,
        usageReasoningTokens: true,
        usageEstimatedCostPicoUsd: true,
      },
    });
    const csv = [
      'attempted_at_utc,model,input_tokens,cached_input_tokens,cache_write_input_tokens,output_tokens,reasoning_tokens,estimated_cost_usd',
      ...rows.map((row) => [
        row.createdAt.toISOString(), row.usageModel, row.usageInputTokens, row.usageCachedInputTokens,
        row.usageCacheWriteInputTokens, row.usageOutputTokens, row.usageReasoningTokens, asUsd(row.usageEstimatedCostPicoUsd),
      ].join(',')),
    ].join('\r\n') + '\r\n';
    return new NextResponse(csv, {
      headers: {
        ...headers,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="guru-usage-${month}.csv"`,
      },
    });
  } catch {
    return new NextResponse(null, { status: 503, headers });
  }
}
