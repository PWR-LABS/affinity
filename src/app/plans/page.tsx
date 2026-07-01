import type { Metadata } from "next";

import { PlanFinder } from "@/components/PlanFinder";

export const metadata: Metadata = {
  title: "See your plans",
  description:
    "Add your doctors and medications to see your real Marketplace plans — net premium after subsidy, deductible, and which plans actually keep your doctors in-network and cover your meds.",
};

export const dynamic = "force-dynamic";

export default function Plans() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">See your real plans</h1>
        <p className="page-subtitle">
          If you&rsquo;re shopping the Marketplace, add your doctors and medications and we&rsquo;ll show your real
          plans — net premium after subsidy, and which plans actually keep <strong>your</strong> doctors in-network
          and cover <strong>your</strong> meds. Coverage comes from the official Marketplace; always confirm with
          the provider&rsquo;s office before enrolling.
        </p>
      </div>
      <PlanFinder />
    </div>
  );
}
