/**
 * Versioned ACA subsidy policy parameters — DATA, separated from the engine math.
 *
 * These constants (federal poverty line, the §36B applicable-percentage schedule, and the Silver CSR
 * bands) are policy that re-indexes yearly and shifts with legislation. They are isolated here, carry a
 * `source` + `verify` flag, and are the ONLY place to change when the IRS Rev. Proc. updates or the live
 * Marketplace API supersedes them. The engine reads them; it never hardcodes a number.
 *
 * ⚠️ 2026 NOTE: the enhanced ARPA/IRA premium tax credits expired 2026-01-01 (per the product vision),
 * so this schedule reverts to the ORIGINAL ACA structure WITH the 400% FPL subsidy cliff. The anchor
 * values below are the last pre-ARPA indexed schedule used as a placeholder — `verify: true` means they
 * must be reconciled against the plan-year Rev. Proc. and the live API's APTC before any cost is shown
 * as authoritative. In live mode the Marketplace API's eligibility estimate is preferred over this math.
 */
import type { MetalLevel } from "./types";

export interface PolicyBracket {
  /** Income as a percent of FPL at this anchor. */
  fplPct: number;
  /** Applicable (expected-contribution) percent of income at this anchor. */
  appPct: number;
}

export interface CsrBand {
  /** Upper bound (inclusive) of the FPL% band. */
  maxFplPct: number;
  variant: string;
  /** Actuarial value of the Silver CSR variant (vs ~0.70 base Silver). */
  av: number;
}

export interface PolicyParams {
  year: number;
  /** 1-person federal poverty line (prior year, 48 contiguous states + DC), in dollars. */
  fplBase: number;
  /** Added FPL per additional household member, in dollars. */
  fplPerAdditional: number;
  /** Minimum FPL% for PTC eligibility (below this is generally Medicaid-eligible). */
  subsidyFloorFplPct: number;
  /** Upper FPL% for PTC eligibility — 400 reinstates the 2026 cliff; null = no cliff (enhanced era). */
  subsidyCeilingFplPct: number | null;
  /** Piecewise-linear applicable-percentage schedule, sorted by fplPct. */
  applicableSchedule: PolicyBracket[];
  /** Native Silver actuarial value (the CSR baseline). */
  silverBaseAv: number;
  /** Silver CSR variants by FPL band. */
  csrBands: CsrBand[];
  source: string;
  /** When true, these constants are placeholders pending Rev. Proc. / live-API verification. */
  verify: boolean;
}

export const POLICY_2026: PolicyParams = {
  year: 2026,
  // 2025 HHS poverty guideline (used for 2026 coverage): 1-person $15,650; +$5,500 per addl person.
  fplBase: 15650,
  fplPerAdditional: 5500,
  subsidyFloorFplPct: 100,
  subsidyCeilingFplPct: 400, // 2026 cliff reinstated (enhanced credits expired 2026-01-01)
  applicableSchedule: [
    { fplPct: 0, appPct: 2.07 },
    { fplPct: 133, appPct: 3.1 },
    { fplPct: 150, appPct: 4.14 },
    { fplPct: 200, appPct: 6.52 },
    { fplPct: 250, appPct: 8.33 },
    { fplPct: 300, appPct: 9.83 },
    { fplPct: 400, appPct: 9.83 },
  ],
  silverBaseAv: 0.7,
  csrBands: [
    { maxFplPct: 150, variant: "94", av: 0.94 },
    { maxFplPct: 200, variant: "87", av: 0.87 },
    { maxFplPct: 250, variant: "73", av: 0.73 },
  ],
  source:
    "Original ACA §36B schedule (last pre-ARPA indexed anchors) + 2025 FPL; placeholder pending plan-year IRS Rev. Proc. and live Marketplace API APTC",
  verify: true,
};

/** Federal poverty line in dollars for a household size. */
export function fplFor(householdSize: number, p: PolicyParams): number {
  const size = Math.max(1, Math.floor(householdSize));
  return p.fplBase + (size - 1) * p.fplPerAdditional;
}

/** Household income as a percent of FPL. */
export function fplPercent(incomeUsd: number, householdSize: number, p: PolicyParams): number {
  return (incomeUsd / fplFor(householdSize, p)) * 100;
}

/** Applicable (expected-contribution) percent of income, piecewise-linear over the schedule. */
export function applicablePercent(fplPct: number, p: PolicyParams): number {
  const sched = p.applicableSchedule;
  if (fplPct <= sched[0].fplPct) return sched[0].appPct;
  const last = sched[sched.length - 1];
  if (fplPct >= last.fplPct) return last.appPct;
  for (let i = 1; i < sched.length; i++) {
    const a = sched[i - 1];
    const b = sched[i];
    if (fplPct <= b.fplPct) {
      const t = (fplPct - a.fplPct) / (b.fplPct - a.fplPct);
      return a.appPct + t * (b.appPct - a.appPct);
    }
  }
  return last.appPct;
}

/** Silver CSR variant + AV for a household's FPL%, or undefined (above the bands / not eligible). */
export function csrFor(
  fplPct: number,
  metal: MetalLevel,
  p: PolicyParams,
): { variant: string; av: number } | undefined {
  if (metal !== "Silver") return undefined;
  for (const band of p.csrBands) {
    if (fplPct <= band.maxFplPct) return { variant: band.variant, av: band.av };
  }
  return undefined;
}
