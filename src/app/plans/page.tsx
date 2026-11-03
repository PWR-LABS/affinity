import type { Metadata } from "next";

import { PlanFinder } from "@/components/PlanFinder";
import { DEFAULT_MARKETPLACE_PLAN_YEAR, parseMarketplacePlanYear } from "@/lib/marketplace/states";

export const metadata: Metadata = {
  title: "See your plans",
  description:
    "Compare 2026 or 2027 Marketplace plans, estimated net premiums, deductibles, and the Marketplace's reported doctor and medication coverage. Confirm details before enrolling.",
};

export const dynamic = "force-dynamic";

export default async function Plans({ searchParams }: { searchParams: Promise<{ year?: string | string[] }> }) {
  const initialYear = parseMarketplacePlanYear((await searchParams).year) ?? DEFAULT_MARKETPLACE_PLAN_YEAR;
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">See your real plans</h1>
        <p className="page-subtitle">
          Choose 2026 or 2027 coverage and compare Marketplace plans by estimated net premium, deductible, and out-of-pocket maximum.
          Add your doctors and medications to see what the Marketplace reports about their coverage. Confirm
          with the provider, plan, and official Marketplace before enrolling.
        </p>
      </div>
      <PlanFinder key={initialYear} initialYear={initialYear} />
    </div>
  );
}
