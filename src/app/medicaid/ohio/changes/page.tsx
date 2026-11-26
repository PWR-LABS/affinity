import type { Metadata } from "next";
import Link from "next/link";

import { OhioMedicaidChangeCheck, OhioMedicaidHelpLinks } from "@/components/OhioMedicaidChangeCheck";
import { OHIO_CHANGE_REVIEWED, OHIO_CHANGE_SOURCES, ohioChangeGuidanceCurrent } from "@/lib/medicaid/ohio-changes";

export const metadata: Metadata = {
  title: "Will the 2027 Ohio Medicaid changes affect me?",
  description: "See whether Ohio’s 2027 Medicaid renewal and work changes may apply to you and find your next step.",
};
export const dynamic = "force-dynamic";

export default function OhioMedicaidChangesPage() {
  return (
    <div className="medicaid-page ohio-change-page">
      <header className="page-header medicaid-hero">
        <p className="medicaid-eyebrow">Ohio Medicaid · 2027</p>
        <h1 className="page-title">Will this change affect me?</h1>
        <p className="page-subtitle">
          If you have Ohio Medicaid, answer two questions to see how the new renewal and work rules might affect you.
          Your answers stay on this page. Ohio makes the final decision about your benefits.
        </p>
      </header>

      {ohioChangeGuidanceCurrent() ? <OhioMedicaidChangeCheck /> : (
        <section className="page-panel" aria-labelledby="ohio-change-review-title">
          <h2 id="ohio-change-review-title">Check your latest Ohio Medicaid notice</h2>
          <p>This guide is due for a source review. Follow the date and instructions on your notice, or contact Ohio Medicaid if your next step is unclear.</p>
          <OhioMedicaidHelpLinks />
        </section>
      )}

      <footer className="medicaid-source-note ohio-change-sources">
        <p>Official sources reviewed {OHIO_CHANGE_REVIEWED}</p>
        <ul>
          <li><a href={OHIO_CHANGE_SOURCES.overview}>Ohio Medicaid Group VIII guide (PDF)</a></li>
          <li><a href={OHIO_CHANGE_SOURCES.work}>Ohio work requirement and exemptions (PDF)</a></li>
          <li><a href={OHIO_CHANGE_SOURCES.renewal}>Federal renewal guidance (PDF)</a></li>
        </ul>
        <Link href="/medicaid">See Medicaid resources for other states</Link>
      </footer>
    </div>
  );
}
