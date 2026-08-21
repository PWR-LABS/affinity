import type { Metadata } from "next";
import Link from "next/link";

import { MedicaidStateGuide } from "@/components/MedicaidStateGuide";
import {
  FEATURED_MEDICAID_CHANGES,
  medicaidChangeUrl,
  medicaidResourceByCode,
} from "@/lib/medicaid/states";

export const metadata: Metadata = {
  title: "Medicaid changes by state",
  description:
    "Track Medicaid eligibility changes nationwide, understand the new federal requirements, and go to the right official state office to apply or renew.",
};

export default function MedicaidPage() {
  return (
    <div className="medicaid-page">
      <div className="page-header medicaid-hero">
        <p className="medicaid-eyebrow">Nationwide Medicaid desk</p>
        <h1 className="page-title">Find—and keep—your Medicaid through the rule changes.</h1>
        <p className="page-subtitle">
          Medicaid is run state by state. We turn the changing federal rules into a clear next step for
          where you live—starting with New York and Ohio.
        </p>
        <div className="medicaid-hero-actions">
          <Link className="cta" href="/#coverage-check">Check likely eligibility</Link>
          <a className="notice-link" href="#state-watch">See state updates</a>
        </div>
      </div>

      <MedicaidStateGuide />

      <section className="medicaid-change" aria-labelledby="national-change-title">
        <p className="medicaid-change-kicker">Federal change · begins January 1, 2027</p>
        <h2 id="national-change-title">Some adults will need to show 80 hours each month.</h2>
        <p>
          Work, school, job training, and community service can count. Many people are excluded or can
          qualify for an exception—including people who are pregnant, disabled, caring for a young child
          or a person with a disability, in substance-use treatment, or covered by Medicare.
        </p>
        <a href="https://www.medicaid.gov/renew-info" target="_blank" rel="noreferrer">
          Read the official federal guide <span aria-hidden="true">↗</span>
        </a>
      </section>

      <section id="state-watch" className="medicaid-state-watch" aria-labelledby="state-watch-title">
        <div className="medicaid-section-head">
          <p className="medicaid-eyebrow">State watch</p>
          <h2 id="state-watch-title">New York and Ohio</h2>
          <p>What is enacted, what is coming, and the safest action to take now.</p>
        </div>

        <div className="medicaid-state-grid">
          {FEATURED_MEDICAID_CHANGES.map((change) => {
            const resource = medicaidResourceByCode(change.code)!;
            return (
              <article className="medicaid-state-card" key={change.code}>
                <div className="medicaid-state-card-head">
                  <span className="medicaid-state-code">{change.code}</span>
                  <div>
                    <h3>{resource.state}</h3>
                    <p>{change.dek}</p>
                  </div>
                </div>
                <p className="medicaid-card-timing">{change.timing}</p>
                <ul>
                  {change.facts.map((fact) => <li key={fact}>{fact}</li>)}
                </ul>
                <p className="medicaid-action"><strong>Do now:</strong> {change.action}</p>
                <div className="medicaid-card-links">
                  <a href={resource.applyUrl} target="_blank" rel="noreferrer">Apply or renew in {resource.state} ↗</a>
                  <a href={change.sourceUrl} target="_blank" rel="noreferrer">State source ↗</a>
                  <a href={medicaidChangeUrl(change.code)} target="_blank" rel="noreferrer">Federal guide ↗</a>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p className="medicaid-source-note">
        Last reviewed August 21, 2026. This is decision support, not an eligibility determination.
        Your state Medicaid agency makes the final decision.
      </p>
    </div>
  );
}
