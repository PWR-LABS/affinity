"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Typeahead, type Suggestion } from "@/components/Typeahead";
import { SUPPORTED_MARKETPLACE_PLAN_YEAR } from "@/lib/marketplace/states";

interface SubjectStatus { key: string; label?: string; covered: boolean | null; priorAuth?: boolean }
interface PlanRow {
  id: string; name: string; metal?: string; type?: string;
  premiumMonthly?: number; netPremiumMonthly?: number; netPremiumAnnual?: number; deductible?: number; oopMax?: number;
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
const covWord = (c: boolean | null, kind: "doctor" | "drug") => c === true
  ? kind === "doctor" ? "listed in-network by the Marketplace" : "listed as covered by the Marketplace"
  : c === false
    ? kind === "doctor" ? "reported out-of-network by the Marketplace" : "reported not covered by the Marketplace"
    : "not answered by the Marketplace";

export function PlanFinder() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [zip, setZip] = useState("");
  const [income, setIncome] = useState("");
  const [age, setAge] = useState("");
  const [householdSize, setHouseholdSize] = useState("1");
  const [doctors, setDoctors] = useState<Array<{ npi: string; label: string }>>([]);
  const [drugs, setDrugs] = useState<Array<{ rxcui: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countyHandoff, setCountyHandoff] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [showAll, setShowAll] = useState(false);
  const inFlight = useRef(false);

  const PAGE = 20;

  const fetchDoctors = useCallback(
    async (q: string): Promise<Suggestion[]> => {
      if (!/^\d{5}$/.test(zip)) return [];
      const r = await fetch("/api/providers/autocomplete", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q, zip }),
      });
      const d = await r.json();
      return (d.items ?? []).map((p: { npi: string; name?: string; specialty?: string }) => ({
        key: p.npi, label: p.name ?? p.npi, sub: p.specialty,
      }));
    },
    [zip],
  );
  const fetchDrugs = useCallback(async (q: string): Promise<Suggestion[]> => {
    const r = await fetch("/api/drugs/autocomplete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }),
    });
    const d = await r.json();
    return (d.items ?? []).map((x: { rxcui: string; label: string }) => ({ key: x.rxcui, label: x.label }));
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    if (!e.currentTarget.reportValidity()) return;
    inFlight.current = true;
    setError(null);
    setCountyHandoff(false);
    setBoard(null);
    setShowAll(false);
    setLoading(true);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          zip: zip.trim(), income: Number(income), age: Number(age), householdSize: Number(householdSize), year: SUPPORTED_MARKETPLACE_PLAN_YEAR,
          doctors: doctors.map((d) => ({ npi: d.npi, label: d.label })),
          drugs: drugs.map((d) => ({ rxcui: d.rxcui, label: d.label })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setCountyHandoff(data.code === "county_ambiguous");
      }
      else setBoard(data as Board);
    } catch {
      setError("We couldn't reach the service. Try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="finder">
      <form className="elig-form page-panel" method="post" onSubmit={onSubmit} aria-busy={loading}>
        <div className="elig-grid">
          <div className="field">
            <label htmlFor="f-zip">ZIP code</label>
            <input id="f-zip" name="zip" type="text" inputMode="numeric" autoComplete="postal-code" pattern="\d{5}" maxLength={5} placeholder="ZIP code"
              value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="f-age">Your age</label>
            <input id="f-age" name="age" type="text" inputMode="numeric" autoComplete="off" placeholder="Age" value={age}
              onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="f-income">Annual household income</label>
            <input id="f-income" name="income" type="text" inputMode="numeric" autoComplete="off" placeholder="Annual income" value={income}
              onChange={(e) => setIncome(e.target.value.replace(/[^\d]/g, ""))} required />
          </div>
          <div className="field">
            <label htmlFor="f-size">People in household</label>
            <input id="f-size" name="householdSize" type="text" inputMode="numeric" autoComplete="off" placeholder="1" value={householdSize}
              onChange={(e) => setHouseholdSize(e.target.value.replace(/\D/g, ""))} required />
            <p className="field-help">This estimate supports one person. For larger households, <a href="https://www.healthcare.gov/see-plans/" target="_blank" rel="noreferrer">use the official Marketplace ↗</a>.</p>
          </div>
        </div>

        <div className="picker-grid">
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
                    <span>{d.label}</span>
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
                    <span>{d.label}</span>
                    <button type="button" aria-label={`Remove ${d.label}`} onClick={() => setDrugs((c) => c.filter((x) => x.rxcui !== d.rxcui))}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="primary primary-lg" disabled={!hydrated} aria-disabled={loading}>
            {loading ? "Finding your plans…" : "Find my plans"}
          </button>
        </div>
      </form>

      <p className="sr-only" role="status" aria-atomic="true">
        {board ? `${board.medicaidEligible ? "You may qualify for Medicaid. " : ""}${board.totalPlans} Marketplace plans in ${board.county ?? "your county"}, ${board.state ?? "your state"} are ready below.` : ""}
      </p>
      {error && <p className="elig-error" role="alert">{error}{countyHandoff ? <> <a href="https://www.healthcare.gov/see-plans/" target="_blank" rel="noreferrer">Choose your county on HealthCare.gov ↗</a></> : null}</p>}

      {board && (
        <section className="board" aria-label="Marketplace plan comparison results">
          {board.medicaidEligible && (
            <div className="demo-banner" style={{ borderColor: "var(--ok)" }}>
              <span aria-hidden>◆</span>
              <span><strong>You may qualify for Medicaid</strong> at this income. Check with your state before relying on these Marketplace price estimates. <a href="/" style={{ color: "var(--accent)" }}>Check Medicaid first →</a></span>
            </div>
          )}
          <p className="board-summary">
            {board.doctorsTotal > 0 ? (
              <>
                <strong>{board.plansKeepingAllDoctors}</strong> of <strong>{board.totalPlans}</strong> plans in{" "}
                {board.county}, {board.state} list {board.doctorsTotal === 1 ? "your doctor" : `all ${board.doctorsTotal} of your doctors`} in-network in the Marketplace data
                {board.aptcMonthly > 0 ? `, with a ${usd(board.aptcMonthly)}/mo subsidy applied` : ""}.
              </>
            ) : (
              <>
                Showing your <strong>{board.totalPlans}</strong> plans in {board.county}, {board.state} by net premium
                {board.aptcMonthly > 0 ? ` (${usd(board.aptcMonthly)}/mo subsidy applied)` : ""}.{" "}
                <strong>Add your doctors and medications above</strong> to see what the Marketplace reports about coverage.
              </>
            )}
          </p>
          <p className="board-cost-note">
            Annual premium below is 12 months of the estimated net premium. It excludes the cost of care,
            so it is not a total annual-cost forecast. The in-network out-of-pocket maximum excludes premiums,
            non-covered services, and out-of-network care. A dash for deductible or out-of-pocket maximum means
            the Marketplace did not give an unambiguous in-network individual combined amount. <a href="https://www.healthcare.gov/choose-a-plan/your-total-costs/" target="_blank" rel="noopener noreferrer">How to compare total costs ↗</a>
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
                    <span className="truecost-label">{p.netPremiumMonthly === undefined ? "premium unavailable" : "after subsidy"}</span>
                  </div>
                </div>
                <div className="plan-row-meta">
                  {p.keepsAllDoctors && p.doctorsTotal > 0 && <span className="keep-badge">✓ Marketplace lists all your doctors</span>}
                  <span>Annual net premium {usd(p.netPremiumAnnual)} · Deductible {usd(p.deductible)} · In-network OOP max {usd(p.oopMax)}</span>
                </div>
                {(p.doctors.length > 0 || p.drugs.length > 0) && (
                  <div className="cov-pills">
                    {p.doctors.map((d) => (
                      <span key={d.key} className="cov-pill" data-cov={d.covered === true ? "y" : d.covered === false ? "n" : "u"} title={`${d.label}: ${covWord(d.covered, "doctor")}`}>
                        {covMark(d.covered)} {(d.label ?? d.key).replace(/^DR\.?\s+/i, "").replace(/\s+(M\.?D\.?|D\.?O\.?).*$/i, "")}
                      </span>
                    ))}
                    {p.drugs.map((d) => (
                      <span key={d.key} className="cov-pill" data-cov={d.covered === true ? "y" : d.covered === false ? "n" : "u"}
                        title={`${d.label}: ${covWord(d.covered, "drug")}${d.priorAuth ? " — this plan requires prior authorization" : ""}`}>
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
