"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useGuruField } from './GuruContext';

import { medicaidChangeUrl, medicaidResourceByCode, STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";
import { DEFAULT_MARKETPLACE_PLAN_YEAR, parseMarketplacePlanYear, stateBasedMarketplace, SUPPORTED_MARKETPLACE_PLAN_YEARS, type MarketplacePlanYear } from "@/lib/marketplace/states";

interface Result {
  sourceFreshness?: "stale";
  year: MarketplacePlanYear;
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
  medicaid: "May qualify for Medicaid",
  marketplace: "Likely Marketplace",
  coverage_gap: "Possible coverage gap",
  state_marketplace: "Use your state service",
  official_handoff: "Official state decision",
  unknown: "Needs review",
};

export function EligibilityCheck() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [state, setState] = useGuruField('state',"");
  const [year, setYear] = useGuruField('year',DEFAULT_MARKETPLACE_PLAN_YEAR);
  const [zip, setZip] = useGuruField('zip',"");
  const [employerOffer,setEmployerOffer]=useGuruField('employerOffer','unknown');
  const [income, setIncome] = useGuruField('income',"");
  const [householdSize, setHouseholdSize] = useGuruField('householdSize',"1");
  const [age, setAge] = useGuruField('age',"");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const requestId = useRef(0);
  useEffect(()=>{requestId.current++;setResult(null);setError(null);setLoading(false);},[state,zip,year,income,householdSize,age,employerOffer]);

  function changeYear(value: string) {
    const next = parseMarketplacePlanYear(value);
    if (next === undefined) return;
    requestId.current += 1;
    setYear(next);
    setResult(null);
    setError(null);
    setLoading(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    if(employerOffer!=='none'){setError('An employer offer needs an affordability and minimum-value review. Use the official Marketplace before relying on savings.');return;}
    const currentRequest = ++requestId.current;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/eligibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state, employerOffer,
          zip: zip.trim(),
          income: Number(income),
          householdSize: Number(householdSize),
          age: Number(age),
          year,
        }),
      });
      const data = await res.json();
      if (currentRequest !== requestId.current) return;
      if (!res.ok) setError(data.error ?? "Something went wrong. Try again.");
      else if (data.year !== year) setError("The coverage year did not match your request. Please check again.");
      else setResult(data as Result);
    } catch {
      if (currentRequest === requestId.current) setError("We couldn't reach the service. Check your connection and try again.");
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  const officialResource = result?.sourceFreshness === "stale" ? undefined : medicaidResourceByCode(result?.state ?? state);
  const officialMarketplace = result?.sourceFreshness === "stale" ? undefined : stateBasedMarketplace(result?.state ?? state, result?.year ?? year);

  return (
    <div className="elig" id="coverage-check">
      <form className="elig-form page-panel" method="post" onSubmit={onSubmit} aria-busy={loading}>
        <div className="elig-grid">
          <div className="field">
            <label htmlFor="shared-employer-offer">Employer insurance offer</label>
            <select id="shared-employer-offer" value={employerOffer} onChange={e=>setEmployerOffer(e.target.value as typeof employerOffer)}>
              <option value="unknown">Not sure yet</option><option value="none">No offer for anyone seeking coverage</option>
              <option value="offered">Offered to me</option><option value="offered_household">Offered through a household member</option>
            </select>
            <p className="field-help">Working alone does not establish an offer. An actual offer needs an official affordability and minimum-value review.</p>
          </div>
          <div className="field">
            <label htmlFor="coverage-year">Coverage year</label>
            <select id="coverage-year" name="year" value={year} onChange={(event) => changeYear(event.target.value)}>
              {SUPPORTED_MARKETPLACE_PLAN_YEARS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <p className="field-help">Choose the year you need coverage.</p>
          </div>
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
            <label htmlFor="age">Age for {year} coverage</label>
            <input id="age" name="age" type="text" inputMode="numeric" autoComplete="off" placeholder="Age" value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="income">Annual household income for {year}</label>
            <input id="income" name="income" type="text" inputMode="numeric" autoComplete="off" placeholder="Annual income"
              value={income} onChange={(e) => setIncome(e.target.value.replace(/[^\d]/g, ""))} required
              aria-describedby="income-help" />
            <p id="income-help" className="field-help">Your best estimate for {year}. Used for screening, not saved as a profile.</p>
          </div>
          <div className="field">
            <label htmlFor="householdSize">People in household</label>
            <input id="householdSize" name="householdSize" type="text" inputMode="numeric" autoComplete="off" placeholder="1" value={householdSize}
              onChange={(e) => setHouseholdSize(e.target.value.replace(/\D/g, ""))} required />
            <p className="field-help">For two or more people, we&rsquo;ll direct you to the official application rather than estimate from one age.</p>
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="primary primary-lg" disabled={!hydrated || loading}>
            {loading ? "Checking…" : "Check my coverage"}
          </button>
        </div>
      </form>

      {error && (
        <p className="elig-error" role="alert">{error}</p>
      )}

      {result && (
        <section className="verdict-card" data-verdict={result.verdict} role="status" aria-live="polite">
          <p className="field-help">Coverage year: {result.year}</p>
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
          {result.sourceFreshness === "stale" ? <div className="verdict-official-actions">
            <a href="https://www.healthcare.gov/marketplace-in-your-state/" target="_blank" rel="noreferrer">Find your official Marketplace ↗</a>
            <a href="https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip" target="_blank" rel="noreferrer">Find your state Medicaid office ↗</a>
          </div> : null}
          {result.verdict === "marketplace" ? (
            <div className="verdict-official-actions" aria-label="Marketplace next steps">
              <Link className="cta" href={`/plans?year=${result.year}`}>Compare {result.year} Marketplace plans →</Link>
              <a href="https://www.healthcare.gov/see-plans/" target="_blank" rel="noreferrer">See official plans and prices ↗</a>
            </div>
          ) : null}
          {officialResource ? (
            <div className="verdict-official-actions" aria-label={`Official ${officialResource.state} resources`}>
              <a className="cta" href={officialResource.applyUrl} target="_blank" rel="noreferrer">
                Open {officialResource.program} official site ↗
              </a>
              <a href={`tel:${officialResource.phone.replace(/[^\d+]/g, "")}`}>Call {officialResource.phone}</a>
              <a href={medicaidChangeUrl(officialResource.code)} target="_blank" rel="noreferrer">See Medicaid changes ↗</a>
              {officialMarketplace ? (
                <a href={`https://${officialMarketplace.url}`} target="_blank" rel="noreferrer">Open {officialMarketplace.name} ↗</a>
              ) : result.verdict === "official_handoff" ? (
                <a href="https://www.healthcare.gov/see-plans/" target="_blank" rel="noreferrer">Open the official Marketplace ↗</a>
              ) : null}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
