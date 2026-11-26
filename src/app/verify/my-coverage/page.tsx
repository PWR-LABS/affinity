import type { Metadata } from "next";

import { CoverageTabs } from "@/components/CoverageTabs";
import { MyCoverage } from "@/components/MyCoverage";
import { getCoverageReadiness } from "@/lib/coverage-readiness";
import { careSourceConfig } from "@/lib/insurers/caresource";

export const metadata: Metadata = {
  title: "My insurance",
  description: "Find your insurer’s member portal and check the health coverage you already have.",
};

export const dynamic = "force-dynamic";

export default async function MyCoveragePage({ searchParams }: {
  searchParams: Promise<{ connection?: string | string[] }>;
}) {
  const [{ connection }, readiness] = await Promise.all([searchParams, getCoverageReadiness()]);
  const result = connection === "ready" || connection === "declined" || connection === "unavailable" ? connection : null;
  const canConnect = Boolean(careSourceConfig());

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Check the coverage you already have</h1>
        <p className="page-subtitle">Find your insurer, confirm your plan, and see what to check when coverage changes.</p>
      </div>
      <CoverageTabs active="mine" readiness={readiness} />
      <MyCoverage key={result} canConnect={canConnect} connection={result} />
    </div>
  );
}
