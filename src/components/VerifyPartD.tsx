"use client";

import { useCallback, useState } from "react";

import { Typeahead, type Suggestion } from "@/components/Typeahead";
import {
  MAX_PARTD_DRUGS,
  addPartDDrugSelection,
  decodePartDPlanSelection,
  encodePartDPlanSelection,
  type PartDDrugSelection,
  type PartDPlanSelection,
} from "@/lib/partd/selection";

interface PartDResult {
  rxcui: string;
  plan: {
    contractId: string;
    planId: string;
    segmentId: string;
    contractYear: number;
  };
  value: "yes" | "no" | "unknown";
  confidence: number;
  formularyTier: string | null;
  source: string;
  sourceUpdated: string | null;
  utilizationManagement: {
    priorAuthorization?: boolean;
    stepTherapy?: boolean;
    quantityLimit?: boolean;
  };
  needsConfirmation: boolean;
}

interface PartDResultRow {
  drug: PartDDrugSelection;
  result?: PartDResult;
  error?: string;
}

const VERDICT: Record<PartDResult["value"], { tag: string; key: string }> = {
  yes: { tag: "Listed on formulary", key: "covered" },
  no: { tag: "Not listed on formulary", key: "not-covered" },
  unknown: { tag: "Unknown - plan not indexed", key: "unknown" },
};

function requirementLabel(value: boolean | undefined): string {
  if (value === true) return "Required";
  if (value === false) return "Not indicated";
  return "Not reported";
}

function resultHeadline(result: PartDResult, drugLabel: string | undefined): string {
  const label = drugLabel ?? `RxCUI ${result.rxcui}`;
  if (result.value === "yes") {
    return `${label} appears on this plan's formulary${result.formularyTier ? ` at tier ${result.formularyTier}` : ""}.`;
  }
  if (result.value === "no") return `${label} does not appear on this plan's formulary.`;
  return `We could not verify ${label} because this plan is not in the loaded index.`;
}

export function VerifyPartD() {
  const [state, setState] = useState("");
  const [plan, setPlan] = useState<PartDPlanSelection | null>(null);
  const [drugs, setDrugs] = useState<PartDDrugSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultRows, setResultRows] = useState<PartDResultRow[]>([]);

  const fetchPlans = useCallback(
    async (q: string): Promise<Suggestion[]> => {
      const params = new URLSearchParams({ q, year: "2026" });
      if (/^[A-Z]{2}$/.test(state)) params.set("state", state);
      const response = await fetch(`/api/partd/plans?${params}`);
      const data = await response.json().catch(() => ({ items: [] }));
      if (!response.ok) return [];
      return (data.items ?? []).map((item: PartDPlanSelection) => ({
        key: encodePartDPlanSelection(item),
        label: item.planName,
        sub: [
          item.state || "National",
          `${item.contractId}-${item.planId}`,
          !/^0+$/.test(item.segmentId) ? `segment ${item.segmentId}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      }));
    },
    [state],
  );

  const fetchDrugs = useCallback(async (q: string): Promise<Suggestion[]> => {
    const response = await fetch(`/api/drugs/autocomplete?q=${encodeURIComponent(q)}`);
    const data = await response.json().catch(() => ({ items: [] }));
    if (!response.ok) return [];
    return (data.items ?? []).map((item: { rxcui: string; label: string }) => ({
      key: item.rxcui,
      label: item.label,
      sub: `RxCUI ${item.rxcui}`,
    }));
  }, []);

  function selectPlan(nextPlan: PartDPlanSelection | null) {
    setPlan(nextPlan);
    setError(null);
    setResultRows([]);
  }

  function addDrug(suggestion: Suggestion) {
    const next = addPartDDrugSelection(drugs, { rxcui: suggestion.key, label: suggestion.label });
    if (next === drugs) {
      setError(
        drugs.some((item) => item.rxcui === suggestion.key)
          ? "That medication is already in the list."
          : `You can check up to ${MAX_PARTD_DRUGS} medications at once.`,
      );
      return;
    }
    setDrugs(next);
    setError(null);
    setResultRows([]);
  }

  function removeDrug(rxcui: string) {
    setDrugs((current) => current.filter((item) => item.rxcui !== rxcui));
    setError(null);
    setResultRows([]);
  }

  async function onVerify() {
    if (!plan || drugs.length === 0) return;
    setError(null);
    setResultRows([]);
    setLoading(true);

    try {
      const rows = await Promise.all(
        drugs.map(async (drug): Promise<PartDResultRow> => {
          try {
            const response = await fetch("/api/partd/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                rxcui: drug.rxcui,
                contractId: plan.contractId,
                planId: plan.planId,
                segmentId: plan.segmentId,
                contractYear: plan.contractYear,
                label: drug.label,
              }),
            });
            const data = await response.json();
            return response.ok
              ? { drug, result: data as PartDResult }
              : { drug, error: data.error ?? "Coverage could not be checked." };
          } catch {
            return { drug, error: "The coverage service could not be reached." };
          }
        }),
      );
      setResultRows(rows);
    } catch {
      setError("We couldn't complete the batch check. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const completedResults = resultRows.flatMap((row) => (row.result ? [row.result] : []));
  const listedCount = completedResults.filter((result) => result.value === "yes").length;
  const notListedCount = completedResults.filter((result) => result.value === "no").length;
  const unknownCount = completedResults.filter((result) => result.value === "unknown").length;
  const checkLabel = drugs.length
    ? `Check ${drugs.length} medication${drugs.length === 1 ? "" : "s"}`
    : "Check medications";

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
          <div className="partd-plan-grid">
            <div className="field partd-state">
              <label htmlFor="partd-state">State (optional)</label>
              <input
                id="partd-state"
                name="state"
                type="text"
                inputMode="text"
                autoComplete="address-level1"
                maxLength={2}
                placeholder="OH"
                value={state}
                onChange={(event) => {
                  setState(event.target.value.replace(/[^a-z]/gi, "").toUpperCase());
                  selectPlan(null);
                }}
              />
            </div>
            <Typeahead
              label="Your Medicare drug plan"
              placeholder="Search plan name or contract ID"
              fetchSuggestions={fetchPlans}
              onSelect={(suggestion) => selectPlan(decodePartDPlanSelection(suggestion.key))}
            />
          </div>
          {plan && (
            <ul className="chips" aria-label="Selected Medicare plan">
              <li className="chip">
                <span>
                  {plan.planName} · {plan.contractId}-{plan.planId}
                  {!/^0+$/.test(plan.segmentId) ? ` · segment ${plan.segmentId}` : ""}
                </span>
                <button type="button" aria-label={`Remove ${plan.planName}`} onClick={() => selectPlan(null)}>
                  ×
                </button>
              </li>
            </ul>
          )}
        </div>

        <div className="verify-section">
          <Typeahead
            label="Your medications"
            placeholder={drugs.length ? "Add another drug, strength, and form" : "Search drug name, strength, and form"}
            fetchSuggestions={fetchDrugs}
            onSelect={addDrug}
          />
          {drugs.length > 0 && (
            <ul className="chips" aria-label={`${drugs.length} selected medications`}>
              {drugs.map((drug) => (
                <li className="chip" key={drug.rxcui}>
                  <span>{drug.label}</span>
                  <button type="button" aria-label={`Remove ${drug.label}`} onClick={() => removeDrug(drug.rxcui)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" className="primary primary-lg" disabled={loading || !plan || drugs.length === 0}>
            {loading
              ? `Checking ${drugs.length} medication${drugs.length === 1 ? "" : "s"}...`
              : checkLabel}
          </button>
        </div>
      </form>

      {error && (
        <p className="elig-error" role="alert">
          {error}
        </p>
      )}

      {resultRows.length > 0 && (
        <section className="partd-results" role="status" aria-live="polite" aria-label="Medication coverage results">
          <div className="partd-results-head">
            <div>
              <p className="partd-results-kicker">Coverage results</p>
              <h2>
                {resultRows.length} medication{resultRows.length === 1 ? "" : "s"} checked
              </h2>
            </div>
            <p className="partd-results-summary">
              {listedCount} listed · {notListedCount} not listed
              {unknownCount ? ` · ${unknownCount} unknown` : ""}
            </p>
          </div>

          <div className="partd-result-list">
            {resultRows.map((row) =>
              row.result ? (
                <article
                  className="verdict-card partd-result-card"
                  data-verdict={VERDICT[row.result.value].key}
                  key={row.drug.rxcui}
                >
                  <span className="verdict-tag">{VERDICT[row.result.value].tag}</span>
                  <h3 className="verdict-headline">{resultHeadline(row.result, row.drug.label)}</h3>
                  <div className="conf-meter" aria-label={`Confidence ${Math.round(row.result.confidence * 100)}%`}>
                    <div
                      className="conf-meter-fill"
                      style={{ width: `${Math.round(row.result.confidence * 100)}%` }}
                    />
                  </div>
                  <p className="verdict-sub">
                    Confidence {Math.round(row.result.confidence * 100)}% · CMS Part D formulary
                    {row.result.sourceUpdated
                      ? `, updated ${row.result.sourceUpdated.slice(0, 10)}`
                      : " · source date unavailable"}
                    .
                  </p>
                  {row.result.value === "yes" && (
                    <dl className="partd-facts">
                      <div>
                        <dt>Formulary tier</dt>
                        <dd>{row.result.formularyTier ?? "Not reported"}</dd>
                      </div>
                      <div>
                        <dt>Prior authorization</dt>
                        <dd>{requirementLabel(row.result.utilizationManagement.priorAuthorization)}</dd>
                      </div>
                      <div>
                        <dt>Step therapy</dt>
                        <dd>{requirementLabel(row.result.utilizationManagement.stepTherapy)}</dd>
                      </div>
                      <div>
                        <dt>Quantity limit</dt>
                        <dd>{requirementLabel(row.result.utilizationManagement.quantityLimit)}</dd>
                      </div>
                    </dl>
                  )}
                  <p className="verdict-note">
                    {row.result.value === "unknown"
                      ? "This plan isn't in the loaded CMS index, so we don't infer a no. Confirm the contract and plan ID on your Medicare card."
                      : "Formularies can change during the year. Confirm the drug, dose, tier, and restrictions with Medicare.gov or the plan before making a coverage decision."}
                  </p>
                </article>
              ) : (
                <article className="verdict-card partd-result-card" data-verdict="unknown" key={row.drug.rxcui}>
                  <span className="verdict-tag">Could not check</span>
                  <h3 className="verdict-headline">{row.drug.label}</h3>
                  <p className="verdict-note">{row.error}</p>
                </article>
              ),
            )}
          </div>
        </section>
      )}
    </div>
  );
}
