import type { Metadata } from "next";

import { CoverageTabs, CoverageUnavailable } from "@/components/CoverageTabs";
import { VerifyPartD } from "@/components/VerifyPartD";
import { getCoverageReadiness } from "@/lib/coverage-readiness";

export const metadata: Metadata = {
  title: "Compare Medicare drug formularies",
  description:
    "Shortlist standalone Medicare Part D plans by medication coverage, tiers, and reported utilization requirements.",
};

export const dynamic = "force-dynamic";

export default async function VerifyMedicareDrug() {
  const readiness = await getCoverageReadiness();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Find Medicare drug plans that list your medications</h1>
        <p className="page-subtitle">
          Compare statewide standalone Part D formularies, or check a plan you already know. Every result
          includes tiers and reported prior authorization, step therapy, and quantity limits.
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
