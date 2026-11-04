/** Beta policy: at most two monthly source cycles. Lookup time never renews source age. */
export const TIC_MAX_SOURCE_AGE_DAYS = 60;

export function ticSourceWindow(now: Date) {
  return { gte: new Date(now.getTime() - TIC_MAX_SOURCE_AGE_DAYS * 86_400_000), lte: now };
}

export function ticSourceCurrent(updated: string | undefined, now: string): boolean {
  const age = Date.parse(now) - Date.parse(updated ?? "");
  return Number.isFinite(age) && age >= 0 && age <= TIC_MAX_SOURCE_AGE_DAYS * 86_400_000;
}
