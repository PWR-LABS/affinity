import { EligibilityCheck } from "@/components/EligibilityCheck";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Where should you start: Medicaid or a Marketplace plan?</h1>
        <p className="page-subtitle">
          Get a live screening estimate where the official feed supports it—and a safe route to the
          right Medicaid decision in every state. Free, private, and neutral.
        </p>
      </div>

      <div className="medicaid-home-alert">
        <div>
          <strong>Medicaid rules are changing.</strong>
          <span> New federal requirements begin in 2027, with renewal changes already moving in New York and Ohio.</span>
        </div>
        <Link href="/medicaid">See what changes for you →</Link>
      </div>

      <EligibilityCheck />
    </div>
  );
}
