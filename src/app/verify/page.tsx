import type { Metadata } from "next";

import { VerifyDoctor } from "@/components/VerifyDoctor";

export const metadata: Metadata = {
  title: "Verify a doctor (beta)",
  description:
    "Check whether a specific doctor is in-network on a commercial/employer plan — answered from the issuer's own federally mandated Transparency-in-Coverage file, with source, freshness, and confidence shown.",
};

export const dynamic = "force-dynamic";

export default function Verify() {
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
      <VerifyDoctor />
    </div>
  );
}
