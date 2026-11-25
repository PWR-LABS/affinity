/** Public beta limits. The daily journey allowances were approved November 23, 2026. */
export const PUBLIC_MONTHLY_USD = '100';
export const PUBLIC_DAILY_USD = '5';
export const VISITOR_LIMITS = { minute: 3, day: 40, month: 50 } as const;
export const NETWORK_LIMITS = { minute: 10, day: 80, month: 150 } as const;
export const TEST_BROWSER_LIMITS = { minute: 15, day: 120, month: 600 } as const;
export function allowanceMessage(scope: string, window: string) {
 const when = window === 'minute' ? 'in a minute' : window === 'day' ? 'after midnight UTC' : 'next calendar month (UTC)';
 const subject = scope === 'visitor' ? 'This browser’s AI allowance' : scope === 'network' ? 'The shared-network AI allowance' : 'The site’s AI allowance';
 return `${subject} has been reached. Try again ${when}. Guided search, coverage checks and comparison tools still work.`;
}
