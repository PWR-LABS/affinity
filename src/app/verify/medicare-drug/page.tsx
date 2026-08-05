import type { Metadata } from "next";

import { CoverageTabs, CoverageUnavailable } from "@/components/CoverageTabs";
import { VerifyPartD } from "@/components/VerifyPartD";
import { getCoverageReadiness } from "@/lib/coverage-readiness";

export const metadata: Metadata = {
  title: "Check Medicare drugs",
  description:
    "Check whether medications appear on a Medicare Part D formulary, including tiers and reported utilization requirements.",
};

export const dynamic = "force-dynamic";

export default async function VerifyMedicareDrug() {
  const readiness = await getCoverageReadiness();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Check medications on a Medicare plan</h1>
        <p className="page-subtitle">
          See whether your medications appear on a plan&rsquo;s CMS-published formulary, their tiers, and whether
          the plan reports prior authorization, step therapy, or quantity limits.
        </p>
      </div>

      <CoverageTabs active="partd" readiness={readiness} />

      {readiness.partD ? (
        <VerifyPartD />
      ) : (
        <CoverageUnavailable>
          The checker is built, but this environment does not currently hold the CMS Part D plan and formulary
          index. No coverage answer will be guessed until both are loaded.
        </CoverageUnavailable>
      )}
    </div>
  );
}
