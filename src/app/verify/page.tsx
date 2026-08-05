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
          it is, and how much to trust it. Never a bare &ldquo;in-network.&rdquo; Coverage of plans is growing
          issuer by issuer.
        </p>
      </div>

      <CoverageTabs active="employer" readiness={readiness} />

      {readiness.employer ? (
        <VerifyDoctor />
      ) : (
        <CoverageUnavailable>
          The checker is built, but this environment does not currently hold both the commercial plan links and
          provider memberships it needs. No network answer will be guessed from an empty index.
        </CoverageUnavailable>
      )}
    </div>
  );
}
