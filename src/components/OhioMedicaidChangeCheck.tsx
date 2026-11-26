"use client";

import { useEffect, useRef, useState } from "react";

import {
  OHIO_CHANGE_SOURCES,
  OHIO_COVERAGE_GROUPS,
  OHIO_MEDICAID_HELP,
  OHIO_NOTICE_OPTIONS,
  ohioChangeResult,
  type OhioCoverageGroup,
  type OhioNotice,
} from "@/lib/medicaid/ohio-changes";

export function OhioMedicaidHelpLinks() {
  return (
    <div className="medicaid-state-actions">
      <a className="cta" href={OHIO_MEDICAID_HELP.portal}>Open Ohio Benefits</a>
      <a className="medicaid-secondary-action" href={OHIO_MEDICAID_HELP.phoneHref}>
        Call Ohio Medicaid at {OHIO_MEDICAID_HELP.phone}
      </a>
    </div>
  );
}

export function OhioMedicaidChangeCheck() {
  const [group, setGroup] = useState<OhioCoverageGroup | "">("");
  const [notice, setNotice] = useState<OhioNotice | "">("");
  const [showResult, setShowResult] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (showResult) resultHeading.current?.focus();
  }, [showResult]);

  const result = showResult && group && notice ? ohioChangeResult(group, notice) : null;

  return (
    <>
      <section className="page-panel ohio-change-form" aria-label="Ohio Medicaid change check">
        <fieldset>
          <legend>What coverage group does Ohio list for you?</legend>
          <p className="medicaid-result-renewal" id="ohio-group-hint">
            Look under View My Benefits in Ohio Benefits or check a recent state notice.
          </p>
          {(Object.keys(OHIO_COVERAGE_GROUPS) as OhioCoverageGroup[]).map((option) => (
            <label className="ohio-change-option" key={option}>
              <input type="radio" aria-describedby="ohio-group-hint" name="coverage-group"
                checked={group === option} onChange={() => { setGroup(option); setShowResult(false); }} />
              {OHIO_COVERAGE_GROUPS[option].label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Did you get a notice about your Medicaid coverage?</legend>
          {(Object.keys(OHIO_NOTICE_OPTIONS) as OhioNotice[]).map((option) => (
            <label className="ohio-change-option" key={option}>
              <input type="radio" name="coverage-notice"
                checked={notice === option} onChange={() => { setNotice(option); setShowResult(false); }} />
              {OHIO_NOTICE_OPTIONS[option].label}
            </label>
          ))}
        </fieldset>
        <button className="cta" type="button" disabled={!group || !notice} onClick={() => setShowResult(true)}>
          See what to do next
        </button>
        <noscript>
          <p>Enable JavaScript to use the check, or use these official Ohio Medicaid resources.</p>
          <OhioMedicaidHelpLinks />
        </noscript>
      </section>

      {result && (
        <section className="page-panel ohio-change-result" aria-labelledby="ohio-change-result-title">
          <h2 id="ohio-change-result-title" tabIndex={-1} ref={resultHeading}>{result.title}</h2>
          <div className="ohio-change-next">
            <h3>{result.next}</h3>
            <p>{result.action}</p>
            <OhioMedicaidHelpLinks />
          </div>
          <div className="medicaid-federal-grid">
            <div>
              <h3>How often you renew</h3>
              <p>{result.renewal}</p>
            </div>
            <div>
              <h3>Work and community engagement</h3>
              <p>{result.work}</p>
            </div>
          </div>
          {group === "expansion" && (
            <details>
              <summary>What might count, and who might be exempt?</summary>
              <p>Approved activities can include work, volunteering, and job training. Most hour-based options require 80 hours per month. Going to school at least half-time can also count.</p>
              <p>Some people may be exempt, including people who are pregnant or recently gave birth, some caregivers, and people with certain health conditions. Ohio may ask for documentation if it can’t verify your situation.</p>
              <a className="medicaid-secondary-action" href={OHIO_CHANGE_SOURCES.work}>Read Ohio’s activity and exemption list (PDF)</a>
            </details>
          )}
        </section>
      )}
    </>
  );
}
