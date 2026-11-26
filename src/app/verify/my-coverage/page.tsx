import type { Metadata } from "next";

import { CoverageTabs } from "@/components/CoverageTabs";
import { MyCoverage } from "@/components/MyCoverage";
import { getCoverageReadiness } from "@/lib/coverage-readiness";

export const metadata: Metadata = {
  title: "My insurance",
  description: "Find your insurer’s member portal and check the health coverage you already have.",
};

export const dynamic = "force-dynamic";

export default async function MyCoveragePage() {
  const readiness = await getCoverageReadiness();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Check the coverage you already have</h1>
        <p className="page-subtitle">Find your insurer, confirm your plan, and see what to check when coverage changes.</p>
      </div>
      <CoverageTabs active="mine" readiness={readiness} />
      <MyCoverage />
    </div>
  );
}
