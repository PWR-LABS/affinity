"use client";

import { useState } from "react";

import {
  STATE_MEDICAID_RESOURCES,
  featuredMedicaidChange,
  medicaidChangeUrl,
  medicaidResourceByCode,
} from "@/lib/medicaid/states";

export function MedicaidStateGuide() {
  const [code, setCode] = useState("");
  const resource = medicaidResourceByCode(code);
  const featured = featuredMedicaidChange(code);

  return (
    <section className="medicaid-state-guide page-panel" aria-labelledby="medicaid-state-guide-title">
      <div>
        <p className="medicaid-eyebrow">All 50 states + D.C.</p>
        <h2 id="medicaid-state-guide-title">Go straight to your state&rsquo;s Medicaid office.</h2>
        <p>Choose where you live for the official application, phone number, and current federal change guide.</p>
      </div>

      <div className="field medicaid-state-picker">
        <label htmlFor="medicaid-state">Your state</label>
        <select id="medicaid-state" value={code} onChange={(event) => setCode(event.target.value)}>
          <option value="">Select a state</option>
          {STATE_MEDICAID_RESOURCES.map((state) => (
            <option key={state.code} value={state.code}>{state.state}</option>
          ))}
        </select>
      </div>

      {resource ? (
        <div className="medicaid-state-result" aria-live="polite">
          <div className="medicaid-state-result-head">
            <span className="medicaid-state-code" aria-hidden="true">{resource.code}</span>
            <div>
              <p className="medicaid-result-label">Official program</p>
              <h3>{resource.program}</h3>
              <p>{featured?.dek ?? "Your state makes the final eligibility and renewal decision."}</p>
            </div>
          </div>

          {featured ? (
            <p className="medicaid-state-alert"><strong>State watch:</strong> {featured.action}</p>
          ) : null}

          <div className="medicaid-state-actions">
            <a className="cta" href={resource.applyUrl} target="_blank" rel="noreferrer">Apply or renew ↗</a>
            <a className="medicaid-secondary-action" href={`tel:${resource.phone.replace(/[^\d+]/g, "")}`}>
              Call {resource.phone}
            </a>
            <a className="medicaid-secondary-action" href={medicaidChangeUrl(resource.code)} target="_blank" rel="noreferrer">
              Eligibility changes ↗
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}
