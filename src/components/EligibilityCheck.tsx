"use client";

import { useState } from "react";

interface Result {
  county?: string;
  state?: string;
  verdict: "medicaid" | "marketplace" | "coverage_gap" | "state_marketplace" | "unknown";
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
  state_marketplace: "Your state's marketplace",
  unknown: "Needs review",
};

export function EligibilityCheck() {
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

  return (
    <div className="elig">
      <form className="elig-form page-panel" onSubmit={onSubmit} noValidate>
        <div className="elig-grid">
          <div className="field">
            <label htmlFor="zip">ZIP code</label>
            <input id="zip" name="zip" inputMode="numeric" autoComplete="postal-code" pattern="\d{5}" maxLength={5}
              placeholder="ZIP code" value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="age">Your age</label>
            <input id="age" name="age" inputMode="numeric" placeholder="Age" value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="income">Annual household income</label>
            <input id="income" name="income" inputMode="numeric" autoComplete="off" placeholder="Annual income"
              value={income} onChange={(e) => setIncome(e.target.value.replace(/[^\d]/g, ""))} required
              aria-describedby="income-help" />
            <p id="income-help" className="field-help">Your best estimate for this year. Stays private — never stored.</p>
          </div>
          <div className="field">
            <label htmlFor="householdSize">People in household</label>
            <input id="householdSize" name="householdSize" inputMode="numeric" placeholder="1" value={householdSize}
              onChange={(e) => setHouseholdSize(e.target.value.replace(/\D/g, ""))} required />
          </div>
        </div>
        <button type="submit" className="primary primary-lg" disabled={loading}>
          {loading ? "Checking…" : "Check my coverage"}
        </button>
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
        </section>
      )}
    </div>
  );
}
