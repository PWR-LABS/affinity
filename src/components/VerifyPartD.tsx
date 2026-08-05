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

interface PartDShortlistDrug {
  rxcui: string;
  value: "yes" | "no";
  tier: number | null;
  priorAuthorization?: boolean;
  stepTherapy?: boolean;
  quantityLimit?: boolean;
}

interface PartDShortlistPlan {
  contractId: string;
  planId: string;
  segmentId: string;
  contractYear: number;
  planName: string;
  state: string | null;
  listedCount: number;
  medicationCount: number;
  restrictedDrugCount: number;
  restrictionFlagCount: number;
  averageTier: number | null;
  drugs: PartDShortlistDrug[];
}

interface PartDShortlist {
  state: string;
  contractYear: number;
  medicationCount: number;
  plansEvaluated: number;
  source: "CMS_PARTD";
  sourceUpdated: string | null;
  checkedAt: string;
  confidence: number;
  plans: PartDShortlistPlan[];
}

type PartDMode = "find" | "check";

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

function restrictionSummary(drug: PartDShortlistDrug): string {
  const restrictions = [
    drug.priorAuthorization ? "Prior authorization" : null,
    drug.stepTherapy ? "Step therapy" : null,
    drug.quantityLimit ? "Quantity limit" : null,
  ].filter((value): value is string => Boolean(value));
  return restrictions.length ? restrictions.join(" · ") : "No reported restrictions";
}

function ExactPlanResults({ rows }: { rows: PartDResultRow[] }) {
  if (rows.length === 0) return null;
  const completedResults = rows.flatMap((row) => (row.result ? [row.result] : []));
  const listedCount = completedResults.filter((result) => result.value === "yes").length;
  const notListedCount = completedResults.filter((result) => result.value === "no").length;
  const unknownCount = completedResults.filter((result) => result.value === "unknown").length;

  return (
    <section className="partd-results" role="status" aria-live="polite" aria-label="Medication coverage results">
      <div className="partd-results-head">
        <div>
          <p className="partd-results-kicker">Coverage results</p>
          <h2>
            {rows.length} medication{rows.length === 1 ? "" : "s"} checked
          </h2>
        </div>
        <p className="partd-results-summary">
          {listedCount} listed · {notListedCount} not listed
          {unknownCount ? ` · ${unknownCount} unknown` : ""}
        </p>
      </div>

      <div className="partd-result-list">
        {rows.map((row) =>
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
  );
}

function ShortlistResults({
  shortlist,
  drugLabelByRxcui,
}: {
  shortlist: PartDShortlist | null;
  drugLabelByRxcui: ReadonlyMap<string, string>;
}) {
  if (!shortlist) return null;

  return (
    <section className="partd-results" role="status" aria-live="polite" aria-label="Part D plan shortlist">
      <div className="partd-results-head">
        <div>
          <p className="partd-results-kicker">Formulary-fit shortlist</p>
          <h2>
            {shortlist.plans.length
              ? `${shortlist.plans.length} leading standalone plans in ${shortlist.state}`
              : `No standalone plans found for ${shortlist.state}`}
          </h2>
        </div>
        <p className="partd-results-summary">
          {shortlist.plansEvaluated} plans compared · not a price ranking
        </p>
      </div>

      {shortlist.plans.length > 0 ? (
        <div className="partd-shortlist">
          {shortlist.plans.map((plan, index) => (
            <article
              className="plan-row partd-shortlist-row"
              data-complete={plan.listedCount === plan.medicationCount}
              key={`${plan.contractId}-${plan.planId}-${plan.segmentId}`}
            >
              <div className="partd-shortlist-head">
                <div>
                  <p className="partd-shortlist-rank">#{index + 1} formulary match</p>
                  <h3>{plan.planName}</h3>
                  <p className="partd-shortlist-id">
                    {plan.contractId}-{plan.planId}
                    {!/^0+$/.test(plan.segmentId) ? ` · segment ${plan.segmentId}` : ""}
                  </p>
                </div>
                <p className="partd-shortlist-coverage">
                  <strong>
                    {plan.listedCount}/{plan.medicationCount}
                  </strong>
                  <span>medications listed</span>
                </p>
              </div>

              <dl className="partd-shortlist-metrics">
                <div>
                  <dt>Restricted medications</dt>
                  <dd>{plan.restrictedDrugCount}</dd>
                </div>
                <div>
                  <dt>Restriction flags</dt>
                  <dd>{plan.restrictionFlagCount}</dd>
                </div>
                <div>
                  <dt>Average tier</dt>
                  <dd>{plan.averageTier ?? "Not reported"}</dd>
                </div>
              </dl>

              <ul className="partd-shortlist-drugs">
                {plan.drugs.map((drug) => (
                  <li data-listed={drug.value === "yes"} key={drug.rxcui}>
                    <span className="partd-shortlist-drug-name">
                      {drugLabelByRxcui.get(drug.rxcui) ?? `RxCUI ${drug.rxcui}`}
                    </span>
                    <span className="partd-shortlist-drug-tier">
                      {drug.value === "yes"
                        ? drug.tier === null
                          ? "Listed · tier not reported"
                          : `Tier ${drug.tier}`
                        : "Not listed"}
                    </span>
                    <span className="partd-shortlist-drug-restrictions">
                      {drug.value === "yes" ? restrictionSummary(drug) : "No restriction data"}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          <p className="partd-shortlist-source">
            Ranked by medications listed, then reported restrictions and average tier. CMS Part D formulary ·{" "}
            {Math.round(shortlist.confidence * 100)}% source confidence
            {shortlist.sourceUpdated
              ? ` · source updated ${shortlist.sourceUpdated.slice(0, 10)}`
              : " · source update date unavailable"}
            . Tiers are not prices. Confirm availability, pharmacy-specific costs, and current restrictions in
            Medicare.gov before enrolling.
          </p>
        </div>
      ) : (
        <div className="coverage-unavailable">
          <strong>No statewide standalone Part D plans were available in the loaded index.</strong>
          <p>Check the state and use Medicare.gov for current plan availability.</p>
        </div>
      )}
    </section>
  );
}

export function VerifyPartD() {
  const [mode, setMode] = useState<PartDMode>("find");
  const [state, setState] = useState("");
  const [plan, setPlan] = useState<PartDPlanSelection | null>(null);
  const [drugs, setDrugs] = useState<PartDDrugSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultRows, setResultRows] = useState<PartDResultRow[]>([]);
  const [shortlist, setShortlist] = useState<PartDShortlist | null>(null);

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
          item.state || (item.contractId.startsWith("S") && state ? `${state} region` : "National"),
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

  function clearResults() {
    setError(null);
    setResultRows([]);
    setShortlist(null);
  }

  function selectMode(nextMode: PartDMode) {
    setMode(nextMode);
    clearResults();
  }

  function selectPlan(nextPlan: PartDPlanSelection | null) {
    setPlan(nextPlan);
    clearResults();
  }

  function updateState(value: string) {
    setState(value.replace(/[^a-z]/gi, "").toUpperCase());
    setPlan(null);
    clearResults();
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
    clearResults();
  }

  function removeDrug(rxcui: string) {
    setDrugs((current) => current.filter((item) => item.rxcui !== rxcui));
    clearResults();
  }

  async function onCheckPlan() {
    if (!plan || drugs.length === 0) return;
    clearResults();
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

  async function onFindPlans() {
    if (!/^[A-Z]{2}$/.test(state) || drugs.length === 0) return;
    clearResults();
    setLoading(true);

    try {
      const response = await fetch("/api/partd/shortlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          rxcuis: drugs.map((drug) => drug.rxcui),
          contractYear: 2026,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Plans could not be compared.");
        return;
      }
      setShortlist(data as PartDShortlist);
    } catch {
      setError("The Medicare Part D index could not be reached.");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit() {
    if (mode === "find") await onFindPlans();
    else await onCheckPlan();
  }

  const medicationCountLabel = `${drugs.length} medication${drugs.length === 1 ? "" : "s"}`;
  const submitLabel =
    mode === "find"
      ? drugs.length
        ? `Find plans for ${medicationCountLabel}`
        : "Find matching plans"
      : drugs.length
        ? `Check ${medicationCountLabel}`
        : "Check medications";
  const canSubmit =
    !loading &&
    drugs.length > 0 &&
    (mode === "find" ? /^[A-Z]{2}$/.test(state) : Boolean(plan));
  const drugLabelByRxcui = new Map(drugs.map((drug) => [drug.rxcui, drug.label]));

  return (
    <div className="verify">
      <form
        className="elig-form page-panel verify-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
        aria-busy={loading}
      >
        <div className="partd-mode-switch" role="group" aria-label="Medicare medication coverage mode">
          <button
            type="button"
            aria-pressed={mode === "find"}
            disabled={loading}
            onClick={() => selectMode("find")}
          >
            Find plans for my medications
          </button>
          <button
            type="button"
            aria-pressed={mode === "check"}
            disabled={loading}
            onClick={() => selectMode("check")}
          >
            Check a plan I know
          </button>
        </div>

        <div className="verify-section">
          {mode === "find" ? (
            <div className="field partd-state-field">
              <label htmlFor="partd-state">State for standalone Part D plans</label>
              <input
                id="partd-state"
                name="state"
                type="text"
                inputMode="text"
                autoComplete="address-level1"
                maxLength={2}
                placeholder="OH"
                value={state}
                onChange={(event) => updateState(event.target.value)}
              />
              <span className="field-help">
                Medicare Advantage plans are excluded because their availability is county-specific.
              </span>
            </div>
          ) : (
            <>
              <div className="partd-plan-grid">
                <div className="field partd-state">
                  <label htmlFor="partd-plan-state">State (optional)</label>
                  <input
                    id="partd-plan-state"
                    name="plan-state"
                    type="text"
                    inputMode="text"
                    autoComplete="address-level1"
                    maxLength={2}
                    placeholder="OH"
                    value={state}
                    onChange={(event) => updateState(event.target.value)}
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
            </>
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
          <button type="submit" className="primary primary-lg" disabled={!canSubmit}>
            {loading ? (mode === "find" ? "Comparing plans..." : `Checking ${medicationCountLabel}...`) : submitLabel}
          </button>
        </div>
      </form>

      {error && (
        <p className="elig-error" role="alert">
          {error}
        </p>
      )}

      <ExactPlanResults rows={resultRows} />
      <ShortlistResults shortlist={shortlist} drugLabelByRxcui={drugLabelByRxcui} />
    </div>
  );
}
