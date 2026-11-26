import type { Metadata } from "next";
import Link from "next/link";

import { CoverageTabs } from "@/components/CoverageTabs";
import { MyCoverage } from "@/components/MyCoverage";
import { getCoverageReadiness } from "@/lib/coverage-readiness";
import { OHIO_MEDICAID_CHANGE_PATH } from "@/lib/medicaid/ohio-changes";

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
      <div className="my-coverage">
        <section className="page-panel coverage-connect" aria-labelledby="ohio-medicaid-change-link">
          <h2 id="ohio-medicaid-change-link">Will Ohio’s 2027 Medicaid changes affect me?</h2>
          <p>Check what the new renewal and work rules may mean for your coverage and what to do next.</p>
          <Link href={OHIO_MEDICAID_CHANGE_PATH}>Check the Ohio Medicaid changes</Link>
        </section>
        <MyCoverage />
      </div>
    </div>
  );
}
