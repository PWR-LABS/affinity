import type { Metadata } from "next";

import { CoverageTabs, CoverageUnavailable } from "@/components/CoverageTabs";
import { VerifyDoctor } from "@/components/VerifyDoctor";
import { getCoverageReadiness } from "@/lib/coverage-readiness";

export const metadata: Metadata = {
  title: "Verify a doctor (beta)",
  description:
    "Check whether a specific doctor is in-network on a commercial/employer plan — answered from the issuer's own federally mandated Transparency-in-Coverage file, with source, freshness, and confidence shown.",
};

export const dynamic = "force-dynamic";

export default async function Verify() {
  const readiness = await getCoverageReadiness();

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Verify a doctor on an employer plan</h1>
        <p className="page-subtitle">
          <strong>Beta.</strong> We check the issuer&rsquo;s own federally mandated Transparency-in-Coverage
          network file — the same data insurers publish about themselves — and tell you what it says, how fresh
          it is, and how much to trust it. Listings must be dated within the last 60 days. Our index
          is partial: a missing doctor is not an out-of-network result. Confirm your exact plan with the insurer.
        </p>
      </div>

      <CoverageTabs active="employer" readiness={readiness} />

      {readiness.employer ? (
        <VerifyDoctor />
      ) : (
        <CoverageUnavailable title="Recent employer sources unavailable.">
          We do not currently have usable employer plan and provider listings with source dates within
          the last 60 days. Data may be missing, undated, or overdue for refresh. Check your insurer’s
          directory and confirm with the provider; this is not evidence that a doctor is out of network.
        </CoverageUnavailable>
      )}
    </div>
  );
}
