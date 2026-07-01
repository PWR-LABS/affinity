import { EligibilityCheck } from "@/components/EligibilityCheck";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Should you be on Medicaid — or a Marketplace plan?</h1>
        <p className="page-subtitle">
          Find out in 30 seconds — free, private, and neutral. We&rsquo;ll tell you whether you still
          qualify for Medicaid or a subsidized plan, and what to do next.
        </p>
      </div>

      <EligibilityCheck />
    </div>
  );
}
