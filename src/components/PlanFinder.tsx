"use client";

import { useCallback, useState } from "react";

import { Typeahead, type Suggestion } from "@/components/Typeahead";

interface SubjectStatus { key: string; label?: string; covered: boolean | null; priorAuth?: boolean }
interface PlanRow {
  id: string; name: string; metal?: string; type?: string;
  premiumMonthly: number; netPremiumMonthly: number; deductible?: number; oopMax?: number;
  docs?: { sbc?: string; brochure?: string; formulary?: string; network?: string };
  doctorsCovered: number; doctorsTotal: number; drugsCovered: number; drugsTotal: number;
  keepsAllDoctors: boolean; doctors: SubjectStatus[]; drugs: SubjectStatus[];
}
interface Board {
  county?: string; state?: string; medicaidEligible: boolean; aptcMonthly: number;
  totalPlans: number; plansKeepingAllDoctors: number; doctorsTotal: number; drugsTotal: number;
  plans: PlanRow[]; notes: string[];
}

const usd = (n?: number) => (typeof n === "number" ? `$${Math.round(n).toLocaleString()}` : "—");
const covMark = (c: boolean | null) => (c === true ? "✓" : c === false ? "✕" : "?");
const covWord = (c: boolean | null) => (c === true ? "in-network" : c === false ? "not covered" : "unknown");

export function PlanFinder() {
  const [zip, setZip] = useState("");
  const [income, setIncome] = useState("");
  const [age, setAge] = useState("");
  const [householdSize, setHouseholdSize] = useState("1");
  const [doctors, setDoctors] = useState<Array<{ npi: string; label: string }>>([]);
  const [drugs, setDrugs] = useState<Array<{ rxcui: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [showAll, setShowAll] = useState(false);

  const PAGE = 20;

  const fetchDoctors = useCallback(
    async (q: string): Promise<Suggestion[]> => {
      if (!/^\d{5}$/.test(zip)) return [];
      const r = await fetch(`/api/providers/autocomplete?q=${encodeURIComponent(q)}&zip=${zip}`);
      const d = await r.json();
      return (d.items ?? []).map((p: { npi: string; name?: string; specialty?: string }) => ({
        key: p.npi, label: p.name ?? p.npi, sub: p.specialty,
      }));
    },
    [zip],
  );
  const fetchDrugs = useCallback(async (q: string): Promise<Suggestion[]> => {
    const r = await fetch(`/api/drugs/autocomplete?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    return (d.items ?? []).map((x: { rxcui: string; label: string }) => ({ key: x.rxcui, label: x.label }));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBoard(null);
    setShowAll(false);
    setLoading(true);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zip: zip.trim(), income: Number(income), age: Number(age), householdSize: Number(householdSize), year: 2026,
          doctors: doctors.map((d) => ({ npi: d.npi, label: d.label })),
          drugs: drugs.map((d) => ({ rxcui: d.rxcui, label: d.label })),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setBoard(data as Board);
    } catch {
      setError("We couldn't reach the service. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="finder">
      <form className="elig-form page-panel" onSubmit={onSubmit} noValidate>
        <div className="elig-grid">
          <div className="field">
            <label htmlFor="f-zip">ZIP code</label>
            <input id="f-zip" inputMode="numeric" pattern="\d{5}" maxLength={5} placeholder="ZIP code"
              value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="f-age">Your age</label>
            <input id="f-age" inputMode="numeric" placeholder="Age" value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="f-income">Annual household income</label>
            <input id="f-income" inputMode="numeric" placeholder="Annual income" value={income}
              onChange={(e) => setIncome(e.target.value.replace(/[^\d]/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="f-size">People in household</label>
            <input id="f-size" inputMode="numeric" placeholder="1" value={householdSize}
              onChange={(e) => setHouseholdSize(e.target.value.replace(/\D/g, ""))} required />
          </div>
        </div>

        <div className="picker-block">
          <Typeahead
            label="Add your doctors"
            placeholder={/^\d{5}$/.test(zip) ? "Search by name, e.g. Smith" : "Enter your ZIP above first"}
            fetchSuggestions={fetchDoctors}
            onSelect={(s) => setDoctors((cur) => (cur.some((d) => d.npi === s.key) ? cur : [...cur, { npi: s.key, label: s.label }]))}
          />
          {doctors.length > 0 && (
            <ul className="chips" aria-label="Selected doctors">
              {doctors.map((d) => (
                <li key={d.npi} className="chip">
                  {d.label}
                  <button type="button" aria-label={`Remove ${d.label}`} onClick={() => setDoctors((c) => c.filter((x) => x.npi !== d.npi))}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="picker-block">
          <Typeahead
            label="Add your medications"
            placeholder="Search by name, e.g. metformin"
            fetchSuggestions={fetchDrugs}
            onSelect={(s) => setDrugs((cur) => (cur.some((d) => d.rxcui === s.key) ? cur : [...cur, { rxcui: s.key, label: s.label }]))}
          />
          {drugs.length > 0 && (
            <ul className="chips" aria-label="Selected medications">
              {drugs.map((d) => (
                <li key={d.rxcui} className="chip">
                  {d.label}
                  <button type="button" aria-label={`Remove ${d.label}`} onClick={() => setDrugs((c) => c.filter((x) => x.rxcui !== d.rxcui))}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="submit" className="primary primary-lg" disabled={loading}>
          {loading ? "Finding your plans…" : "Find my plans"}
        </button>
      </form>

      {error && <p className="elig-error" role="alert">{error}</p>}

      {board && (
        <section className="board" aria-live="polite">
          {board.medicaidEligible && (
            <div className="demo-banner" style={{ borderColor: "var(--ok)" }}>
              <span aria-hidden>◆</span>
              <span><strong>You may qualify for free Medicaid</strong> at this income — these Marketplace plans would cost full price. <a href="/" style={{ color: "var(--accent)" }}>Check Medicaid first →</a></span>
            </div>
          )}
          <p className="board-summary">
            {board.doctorsTotal > 0 ? (
              <>
                <strong>{board.plansKeepingAllDoctors}</strong> of <strong>{board.totalPlans}</strong> plans in{" "}
                {board.county}, {board.state} keep {board.doctorsTotal === 1 ? "your doctor" : `all ${board.doctorsTotal} of your doctors`} in-network
                {board.aptcMonthly > 0 ? `, with a ${usd(board.aptcMonthly)}/mo subsidy applied` : ""}.
              </>
            ) : (
              <>
                Showing your <strong>{board.totalPlans}</strong> plans in {board.county}, {board.state} by net premium
                {board.aptcMonthly > 0 ? ` (${usd(board.aptcMonthly)}/mo subsidy applied)` : ""}.{" "}
                <strong>Add your doctors and medications above</strong> to see which plans actually cover them.
              </>
            )}
          </p>

          <div className="board-rows">
            {(showAll ? board.plans : board.plans.slice(0, PAGE)).map((p) => {
              const detail = p.docs?.sbc ?? p.docs?.brochure ?? p.docs?.network;
              const docLinks = [
                { url: p.docs?.sbc, label: "Summary of Benefits" },
                { url: p.docs?.brochure, label: "Brochure" },
                { url: p.docs?.formulary, label: "Drug list" },
                { url: p.docs?.network, label: "Provider directory" },
              ].filter((d) => Boolean(d.url));
              return (
              <article key={p.id} className="plan-row" data-keep={p.keepsAllDoctors ? "1" : undefined} data-clickable={detail ? "1" : undefined}>
                <div className="plan-row-head">
                  <div>
                    <h3 className="plan-name">
                      {detail ? (
                        <a href={detail} target="_blank" rel="noopener noreferrer" className="plan-name-link">
                          {p.name} <span className="plan-ext" aria-hidden>↗</span>
                        </a>
                      ) : (
                        p.name
                      )}
                    </h3>
                    <span className="plan-metal">{p.metal}{p.type ? ` · ${p.type}` : ""}</span>
                  </div>
                  <div className="truecost">
                    <div className="truecost-figure">{usd(p.netPremiumMonthly)}<span style={{ fontSize: "0.7rem", fontWeight: 400 }}>/mo</span></div>
                    <span className="truecost-label">after subsidy</span>
                  </div>
                </div>
                <div className="plan-row-meta">
                  {p.keepsAllDoctors && p.doctorsTotal > 0 && <span className="keep-badge">✓ keeps all your doctors</span>}
                  <span>Deductible {usd(p.deductible)} · OOP max {usd(p.oopMax)}</span>
                </div>
                {(p.doctors.length > 0 || p.drugs.length > 0) && (
                  <div className="cov-pills">
                    {p.doctors.map((d) => (
                      <span key={d.key} className="cov-pill" data-cov={d.covered === true ? "y" : d.covered === false ? "n" : "u"} title={`${d.label}: ${covWord(d.covered)}`}>
                        {covMark(d.covered)} {(d.label ?? d.key).replace(/^DR\.?\s+/i, "").replace(/\s+(M\.?D\.?|D\.?O\.?).*$/i, "")}
                      </span>
                    ))}
                    {p.drugs.map((d) => (
                      <span key={d.key} className="cov-pill" data-cov={d.covered === true ? "y" : d.covered === false ? "n" : "u"}
                        title={`${d.label}: ${covWord(d.covered)}${d.priorAuth ? " — this plan requires prior authorization" : ""}`}>
                        {covMark(d.covered)} {d.label ?? d.key}
                        {d.priorAuth && <span className="pa-note" aria-label="prior authorization required">⚠ PA</span>}
                      </span>
                    ))}
                  </div>
                )}
                {docLinks.length > 0 && (
                  <div className="plan-docs">
                    <span className="plan-docs-label">Plan docs:</span>
                    {docLinks.map((d) => (
                      <a key={d.label} href={d.url} target="_blank" rel="noopener noreferrer">{d.label}</a>
                    ))}
                  </div>
                )}
              </article>
              );
            })}
          </div>
          {!showAll && board.plans.length > PAGE && (
            <button type="button" className="show-more" onClick={() => setShowAll(true)}>
              Show all {board.plans.length} plans
            </button>
          )}
          {board.notes.map((n, i) => <p key={i} className="verdict-note">{n}</p>)}
        </section>
      )}
    </div>
  );
}
