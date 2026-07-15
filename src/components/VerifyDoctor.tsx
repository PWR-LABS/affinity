"use client";

import { useCallback, useState } from "react";

import { Typeahead, type Suggestion } from "@/components/Typeahead";

interface VerifyResult {
  npi: string;
  plan: { idType: string; id: string };
  value: "yes" | "no" | "unknown";
  confidence: number;
  source: string;
  sourceUpdated: string | null;
  rendered: string;
  needsConfirmation: boolean;
}

const VERDICT: Record<VerifyResult["value"], { tag: string; key: string }> = {
  yes: { tag: "Shown in-network", key: "covered" },
  no: { tag: "Shown NOT in-network", key: "not-covered" },
  unknown: { tag: "Unknown — not in the index", key: "unknown" },
};

export function VerifyDoctor() {
  const [zip, setZip] = useState("");
  const [doctor, setDoctor] = useState<{ npi: string; label: string } | null>(null);
  const [npiDirect, setNpiDirect] = useState("");
  const [plan, setPlan] = useState<{ idType: string; id: string; label: string } | null>(null);
  const [einDirect, setEinDirect] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const fetchDoctors = useCallback(
    async (q: string): Promise<Suggestion[]> => {
      if (!/^\d{5}$/.test(zip)) return [];
      const r = await fetch(`/api/providers/autocomplete?q=${encodeURIComponent(q)}&zip=${zip}`);
      const d = await r.json();
      return (d.items ?? []).map((p: { npi: string; name?: string; specialty?: string }) => ({
        key: p.npi,
        label: p.name ?? p.npi,
        sub: p.specialty,
      }));
    },
    [zip],
  );

  const fetchPlans = useCallback(async (q: string): Promise<Suggestion[]> => {
    const r = await fetch(`/api/tic/plans?q=${encodeURIComponent(q)}`);
    const d = await r.json().catch(() => ({ items: [] }));
    if (!r.ok) return []; // index absent in this environment — verify via EIN still explains it clearly
    return (d.items ?? []).map((p: { planIdType: string; planId: string; planName: string; issuer: string }) => ({
      key: `${p.planIdType}:${p.planId}:${p.planName}`,
      label: p.planName,
      sub: `${p.issuer} · ${p.planIdType.toUpperCase()} ${p.planId}`,
    }));
  }, []);

  const fetchEmployers = useCallback(async (q: string): Promise<Suggestion[]> => {
    const r = await fetch(`/api/employers/search?q=${encodeURIComponent(q)}`);
    const d = await r.json().catch(() => ({ items: [] }));
    if (!r.ok) return [];
    return (d.items ?? []).map((e: { ein: string; name: string; state?: string | null; planName?: string | null }) => {
      const bits = [e.state, `EIN ${e.ein}`].filter(Boolean);
      return {
        key: e.ein,
        label: e.name,
        sub: `${bits.join(" · ")}${e.planName ? ` (${e.planName})` : ""}`,
      };
    });
  }, []);

  const npi = doctor?.npi ?? (/^\d{10}$/.test(npiDirect) ? npiDirect : null);
  const planSel = plan ?? (/^\d{9}$/.test(einDirect) ? { idType: "ein", id: einDirect, label: `Employer EIN ${einDirect}` } : null);

  async function onVerify() {
    if (!npi || !planSel) return;
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/tic/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ npi, planIdType: planSel.idType, planId: planSel.id, label: doctor?.label }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Something went wrong.");
      else setResult(data as VerifyResult);
    } catch {
      setError("We couldn't reach the service. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="verify">
      <form
        className="elig-form page-panel verify-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onVerify();
        }}
        aria-busy={loading}
      >
        <div className="verify-section">
          <div className="elig-grid verify-grid">
            <div className="field">
              <label htmlFor="v-zip">Your ZIP (to search doctors by name)</label>
              <input id="v-zip" name="zip" type="text" inputMode="numeric" autoComplete="postal-code" pattern="\d{5}" maxLength={5} placeholder="ZIP code"
                value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="field">
              <label htmlFor="v-npi">…or paste an NPI directly</label>
              <input id="v-npi" name="npi" type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="10-digit NPI"
                value={npiDirect} onChange={(e) => { setNpiDirect(e.target.value.replace(/\D/g, "")); setDoctor(null); }} />
            </div>
          </div>
          <Typeahead
            label="Your doctor"
            placeholder={/^\d{5}$/.test(zip) ? "Search by name, e.g. Smith" : "Enter your ZIP first, or paste an NPI"}
            fetchSuggestions={fetchDoctors}
            onSelect={(s) => { setDoctor({ npi: s.key, label: s.label }); setNpiDirect(""); }}
          />
          {doctor && (
            <ul className="chips" aria-label="Selected doctor">
              <li className="chip"><span>{doctor.label}</span>
                <button type="button" aria-label={`Remove ${doctor.label}`} onClick={() => setDoctor(null)}>×</button>
              </li>
            </ul>
          )}
        </div>

        <div className="verify-section">
          <Typeahead
            label="Your plan"
            placeholder="Search plan or network name, e.g. SuperMed"
            fetchSuggestions={fetchPlans}
            onSelect={(s) => {
              const [idType, id] = s.key.split(":");
              setPlan({ idType, id, label: s.label });
              setEinDirect("");
            }}
          />
          <div className="verify-stack">
            <Typeahead
              label="…or search your employer"
              placeholder="Employer name, e.g. Kroger"
              fetchSuggestions={fetchEmployers}
              onSelect={(s) => {
                setPlan({ idType: "ein", id: s.key, label: s.label });
                setEinDirect("");
              }}
            />
          </div>
          <div className="field verify-stack">
            <label htmlFor="v-ein">…or your employer&rsquo;s EIN (on your W-2, box b)</label>
            <input id="v-ein" name="ein" type="text" inputMode="numeric" autoComplete="off" maxLength={9} placeholder="9-digit EIN"
              value={einDirect} onChange={(e) => { setEinDirect(e.target.value.replace(/\D/g, "")); setPlan(null); }}
              aria-describedby="ein-help" />
            <p id="ein-help" className="field-help">Employer plans are keyed by the employer&rsquo;s tax ID. Stays private — never stored.</p>
          </div>
          {planSel && (
            <ul className="chips" aria-label="Selected plan">
              <li className="chip"><span>{planSel.label}</span>
                <button type="button" aria-label={`Remove ${planSel.label}`} onClick={() => { setPlan(null); setEinDirect(""); }}>×</button>
              </li>
            </ul>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" className="primary primary-lg" disabled={loading || !npi || !planSel}>
            {loading ? "Checking the issuer's file…" : "Verify coverage"}
          </button>
        </div>
      </form>

      {error && <p className="elig-error" role="alert">{error}</p>}

      {result && (
        <section className="verdict-card" data-verdict={VERDICT[result.value].key} role="status" aria-live="polite">
          <span className="verdict-tag">{VERDICT[result.value].tag}</span>
          <h2 className="verdict-headline">{result.rendered}</h2>
          <div className="conf-meter" aria-label={`Confidence ${Math.round(result.confidence * 100)}%`}>
            <div className="conf-meter-fill" style={{ width: `${Math.round(result.confidence * 100)}%` }} />
          </div>
          <p className="verdict-sub">
            Confidence {Math.round(result.confidence * 100)}% · one source (the issuer&rsquo;s federally mandated
            Transparency-in-Coverage file{result.sourceUpdated ? `, updated ${result.sourceUpdated.slice(0, 10)}` : ""}).
          </p>
          <p className="verdict-note">
            {result.value === "unknown"
              ? "This plan isn't in our commercial index yet — we only answer from sources we actually hold. Check the issuer's own directory, or try the plan-name search above."
              : "Commercial coverage here is doctors-only for now (no federal drug-list feed exists for employer plans). Always confirm with the provider's office and your plan before relying on this."}
          </p>
        </section>
      )}
    </div>
  );
}
