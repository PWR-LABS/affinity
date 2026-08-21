"use client";

import { useState } from "react";

import { medicaidChangeUrl, medicaidResourceByCode, STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";
import { stateBasedMarketplace } from "@/lib/marketplace/states";

interface Result {
  county?: string;
  state?: string;
  verdict: "medicaid" | "marketplace" | "coverage_gap" | "state_marketplace" | "official_handoff" | "unknown";
  aptcMonthly: number;
  planCount?: number;
  headline: string;
  nextSteps: string[];
  notes: string[];
}

const VERDICT_LABEL: Record<Result["verdict"], string> = {
  medicaid: "Likely Medicaid (free)",
  marketplace: "Likely Marketplace",
  coverage_gap: "Possible coverage gap",
  state_marketplace: "Use your state service",
  official_handoff: "Official state decision",
  unknown: "Needs review",
};

export function EligibilityCheck() {
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [income, setIncome] = useState("");
  const [householdSize, setHouseholdSize] = useState("1");
  const [age, setAge] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/eligibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          zip: zip.trim(),
          income: Number(income),
          householdSize: Number(householdSize),
          age: Number(age),
          year: 2026,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong. Try again.");
      else setResult(data as Result);
    } catch {
      setError("We couldn't reach the service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const officialResource = medicaidResourceByCode(result?.state ?? state);
  const officialMarketplace = stateBasedMarketplace(result?.state ?? state);

  return (
    <div className="elig" id="coverage-check">
      <form className="elig-form page-panel" onSubmit={onSubmit} noValidate aria-busy={loading}>
        <div className="elig-grid">
          <div className="field">
            <label htmlFor="state">State</label>
            <select id="state" name="state" autoComplete="address-level1" value={state} onChange={(event) => setState(event.target.value)} required>
              <option value="">Select a state</option>
              {STATE_MEDICAID_RESOURCES.map((resource) => (
                <option key={resource.code} value={resource.code}>{resource.state}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="zip">ZIP code</label>
            <input id="zip" name="zip" type="text" inputMode="numeric" autoComplete="postal-code" pattern="\d{5}" maxLength={5}
              placeholder="ZIP code" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="age">Your age</label>
            <input id="age" name="age" type="text" inputMode="numeric" autoComplete="off" placeholder="Age" value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="income">Annual household income</label>
            <input id="income" name="income" type="text" inputMode="numeric" autoComplete="off" placeholder="Annual income"
              value={income} onChange={(e) => setIncome(e.target.value.replace(/[^\d]/g, ""))} required
              aria-describedby="income-help" />
            <p id="income-help" className="field-help">Your best estimate for this year. Stays private — never stored.</p>
          </div>
          <div className="field">
            <label htmlFor="householdSize">People in household</label>
            <input id="householdSize" name="householdSize" type="text" inputMode="numeric" autoComplete="off" placeholder="1" value={householdSize}
              onChange={(e) => setHouseholdSize(e.target.value.replace(/\D/g, ""))} required />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary primary-lg" disabled={loading}>
            {loading ? "Checking…" : "Check my coverage"}
          </button>
        </div>
      </form>

      {error && (
        <p className="elig-error" role="alert">{error}</p>
      )}

      {result && (
        <section className="verdict-card" data-verdict={result.verdict} role="status" aria-live="polite">
          <span className="verdict-tag">{VERDICT_LABEL[result.verdict]}</span>
          <h2 className="verdict-headline">{result.headline}</h2>
          {result.nextSteps.length > 0 && (
            <>
              <p className="verdict-sub">What to do next:</p>
              <ul className="verdict-steps">
                {result.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
          {result.notes.map((n, i) => <p key={i} className="verdict-note">{n}</p>)}
          {officialResource ? (
            <div className="verdict-official-actions" aria-label={`Official ${officialResource.state} resources`}>
              <a className="cta" href={officialResource.applyUrl} target="_blank" rel="noreferrer">
                Apply or renew with {officialResource.program} ↗
              </a>
              <a href={`tel:${officialResource.phone.replace(/[^\d+]/g, "")}`}>Call {officialResource.phone}</a>
              <a href={medicaidChangeUrl(officialResource.code)} target="_blank" rel="noreferrer">See Medicaid changes ↗</a>
              {officialMarketplace ? (
                <a href={`https://${officialMarketplace.url}`} target="_blank" rel="noreferrer">Open {officialMarketplace.name} ↗</a>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
