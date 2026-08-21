import type { Metadata } from "next";
import Link from "next/link";

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
        <h1 className="page-title">Keep your Medicaid through the rule changes.</h1>
        <p className="page-subtitle">
          Medicaid is run state by state. We turn the changing federal rules into a clear next step for
          where you live—starting with New York and Ohio.
        </p>
        <div className="medicaid-hero-actions">
          <Link className="cta" href="/#coverage-check">Check likely eligibility</Link>
          <a className="notice-link" href="#state-watch">See state updates</a>
        </div>
      </div>

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
          <article className="medicaid-state-card">
            <div className="medicaid-state-card-head">
              <span className="medicaid-state-code">NY</span>
              <div>
                <h3>New York</h3>
                <p>Renewal protections are narrowing.</p>
              </div>
            </div>
            <ul>
              <li>Most adults are returning to standard renewal checks after twelve-month continuous eligibility ended.</li>
              <li>Some children under six are also returning to standard renewals.</li>
              <li>The new federal work and community-engagement rules are expected January 1, 2027.</li>
            </ul>
            <p className="medicaid-action"><strong>Do now:</strong> update your contact information and respond to every NY State of Health renewal notice.</p>
            <div className="medicaid-card-links">
              <a href="https://nystateofhealth.ny.gov/" target="_blank" rel="noreferrer">Apply or renew in New York ↗</a>
              <a href="https://www.health.ny.gov/health_care/medicaid/" target="_blank" rel="noreferrer">Official NY updates ↗</a>
            </div>
          </article>

          <article className="medicaid-state-card">
            <div className="medicaid-state-card-head">
              <span className="medicaid-state-code">OH</span>
              <div>
                <h3>Ohio</h3>
                <p>More frequent checks are already in state law.</p>
              </div>
            </div>
            <ul>
              <li>Ohio law calls for Medicaid expansion eligibility to be reviewed every six months when federal law allows.</li>
              <li>CMS says affected adults should prepare to document work, school, training, or volunteer hours.</li>
              <li>People who meet an exclusion should gather medical, caregiving, or other supporting records.</li>
            </ul>
            <p className="medicaid-action"><strong>Do now:</strong> update your Ohio Benefits account, save monthly records, and watch for a state notice.</p>
            <div className="medicaid-card-links">
              <a href="https://ssp.benefits.ohio.gov/" target="_blank" rel="noreferrer">Apply or renew in Ohio ↗</a>
              <a href="https://www.medicaid.gov/renew-info/OH" target="_blank" rel="noreferrer">Official Ohio change guide ↗</a>
            </div>
          </article>
        </div>
      </section>

      <p className="medicaid-source-note">
        Last reviewed August 21, 2026. This is decision support, not an eligibility determination.
        Your state Medicaid agency makes the final decision.
      </p>
    </div>
  );
}
