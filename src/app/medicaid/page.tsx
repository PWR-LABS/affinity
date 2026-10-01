import type { Metadata } from "next";
import Link from "next/link";

import { MedicaidStateGuide } from "@/components/MedicaidStateGuide";
import { FEDERAL_MEDICAID_CHANGES, MEDICAID_GUIDANCE_REVIEWED } from "@/lib/medicaid/federal";
import {
  FEATURED_MEDICAID_CHANGES,
  medicaidChangeUrl,
  medicaidResourceByCode,
} from "@/lib/medicaid/states";

export const metadata: Metadata = {
  title: "Medicaid changes by state",
  description:
    "Track Medicaid eligibility changes nationwide, understand the new federal requirements, and find your state's official application or account site. Follow your notice for renewal steps.",
};

export default function MedicaidPage() {
  return (
    <div className="medicaid-page">
      <div className="page-header medicaid-hero">
        <p className="medicaid-eyebrow">Nationwide Medicaid desk</p>
        <h1 className="page-title">Understand Medicaid changes. Find your official next step.</h1>
        <p className="page-subtitle">
          Medicaid decisions happen state by state. See what the federal rules say, then go directly to
          your state&rsquo;s official Medicaid site. Follow your state notice for renewal steps.
        </p>
        <div className="medicaid-hero-actions">
          <Link className="cta" href="/#coverage-check">Check likely eligibility</Link>
          <a className="notice-link" href="#state-watch">See state updates</a>
        </div>
      </div>

      <MedicaidStateGuide />

      <section className="medicaid-federal" aria-labelledby="federal-changes-title">
        <div className="medicaid-section-head">
          <p className="medicaid-eyebrow">Federal policy · reviewed {MEDICAID_GUIDANCE_REVIEWED}</p>
          <h2 id="federal-changes-title">Two changes, with different rules about who is affected.</h2>
          <p>Your state decides your eligibility and sends the notice that governs your next step.</p>
        </div>
        <div className="medicaid-federal-grid">
          {FEDERAL_MEDICAID_CHANGES.map((change) => (
            <article className="medicaid-change" key={change.id}>
              <p className="medicaid-change-kicker">{change.kicker}</p>
              <h3>{change.title}</h3>
              <p>{change.summary}</p>
              <p className="medicaid-change-action"><strong>What to do now:</strong> {change.nextStep}</p>
              <a href={change.sourceUrl} target="_blank" rel="noreferrer">
                {change.sourceLabel} <span aria-hidden="true">↗</span>
              </a>
            </article>
          ))}
        </div>
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
                  <a href={resource.applyUrl} target="_blank" rel="noreferrer">Open {resource.state} official site ↗</a>
                  {change.sources.map((source) => (
                    <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} ↗</a>
                  ))}
                  <a href={medicaidChangeUrl(change.code)} target="_blank" rel="noreferrer">Federal guide ↗</a>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p className="medicaid-source-note">
        Policy sources reviewed {MEDICAID_GUIDANCE_REVIEWED}. This is navigation and screening, not an
        eligibility determination or a way to submit a renewal. Your state Medicaid agency makes the
        final decision. Follow the date and instructions on your official notice.
      </p>
    </div>
  );
}
