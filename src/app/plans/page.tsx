import type { Metadata } from "next";

import { PlanFinder } from "@/components/PlanFinder";

export const metadata: Metadata = {
  title: "See your plans",
  description:
    "Compare 2026 Marketplace plans, estimated net premiums, deductibles, and the Marketplace's reported doctor and medication coverage. Confirm details before enrolling.",
};

export const dynamic = "force-dynamic";

export default function Plans() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">See your real plans</h1>
        <p className="page-subtitle">
          Compare 2026 Marketplace plans by estimated net premium, deductible, and out-of-pocket maximum.
          Add your doctors and medications to see what the Marketplace reports about their coverage. Confirm
          with the provider, plan, and official Marketplace before enrolling.
        </p>
      </div>
      <PlanFinder />
    </div>
  );
}
