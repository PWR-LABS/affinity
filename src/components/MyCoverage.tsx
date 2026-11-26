"use client";

import { useEffect, useRef, useState } from "react";

import type { CareSourceResult } from "@/lib/insurers/caresource";
import { findOhioCoverageResources } from "@/lib/insurers/ohio-insurers";

const PORTAL = "https://mylife.caresource.com/";

const errors = {
  declined: "You didn’t share coverage with [affinity.]. You can still check in the CareSource portal.",
  unavailable: "Couldn’t verify your coverage. Try again or check in the CareSource portal.",
} as const;

const STATUS = { active: "Active on record", cancelled: "Cancelled on record", unknown: "Status unavailable" };
const CHECKED_DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" });

export function MyCoverage({ canConnect, connection }: {
  canConnect: boolean;
  connection: "ready" | "declined" | "unavailable" | null;
}) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<CareSourceResult | keyof typeof errors | null>(
    connection === "declined" || connection === "unavailable" ? connection : null,
  );
  const [loading, setLoading] = useState(connection === "ready" && canConnect);
  const [starting, setStarting] = useState(false);
  const resultRequest = useRef<Promise<CareSourceResult> | null>(null);

  useEffect(() => {
    if (connection !== "ready" || !canConnect) return;
    // React may re-run effects. Share this one-time exchange within the mounted page.
    resultRequest.current ??= fetch("/api/insurer/caresource/result", {
      method: "POST", cache: "no-store", credentials: "same-origin",
    }).then(async response => {
      if (!response.ok) throw new Error("CareSource coverage unavailable");
      return await response.json() as CareSourceResult;
    });
    let mounted = true;
    const clearOnLeave = () => {
      mounted = false;
      resultRequest.current = null;
      setOutcome(null);
      setLoading(false);
    };
    window.addEventListener("pagehide", clearOnLeave);
    resultRequest.current.then(
      result => { if (mounted) setOutcome(result); },
      () => { if (mounted) setOutcome("unavailable"); },
    ).finally(() => { if (mounted) setLoading(false); });
    return () => {
      mounted = false;
      window.removeEventListener("pagehide", clearOnLeave);
    };
  }, [canConnect, connection]);

  const resources = findOhioCoverageResources(query);

  async function connectCareSource() {
    setStarting(true);
    try {
      const response = await fetch("/api/insurer/caresource/start", {
        method: "POST", cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) throw new Error("CareSource connection unavailable");
      const { authorizationUrl } = await response.json() as { authorizationUrl: string };
      window.location.assign(authorizationUrl);
    } catch {
      setStarting(false);
      setOutcome("unavailable");
    }
  }

  return (
    <div className="my-coverage">
      <section className="page-panel coverage-connect" aria-labelledby="connect-insurance">
        <div>
          <h2 id="connect-insurance">Connect my insurance</h2>
          <h3>CareSource Ohio Medicaid</h3>
          {canConnect ? (
            <p>Sign in with CareSource and choose whether to share your coverage record. See the plan, status, and dates CareSource reports.</p>
          ) : (
            <p>Direct connection is being prepared. Sign in to CareSource to check your current plan and coverage dates.</p>
          )}
        </div>
        <div className="coverage-connect-actions">
          {canConnect && (
            <button className="cta" type="button" onClick={connectCareSource} disabled={loading || starting}>
              {starting ? "Connecting to CareSource…" : "Connect CareSource"}
            </button>
          )}
          <a href={PORTAL}>Open CareSource member portal</a>
        </div>
        <div role="status" aria-live="polite">
          {loading && <p>Checking your CareSource coverage…</p>}
          {typeof outcome === "string" && <p>{errors[outcome]}</p>}
          {outcome && typeof outcome !== "string" && (
            <div className="coverage-result">
              {outcome.rows.length === 0 ? (
                <p>Couldn’t verify Ohio Medicaid coverage from the records returned. Check the CareSource portal for your current plan.</p>
              ) : (
                <>
                  <h3>Coverage reported by CareSource</h3>
                  <p>Checked <time dateTime={outcome.checkedAt}>{CHECKED_DATE.format(new Date(outcome.checkedAt))}</time></p>
                  <ul className="coverage-result-rows">
                    {outcome.rows.map((row, index) => (
                      <li key={index}>
                        <strong>{row.planName ?? "CareSource Ohio Medicaid plan"}</strong>
                        <p>{STATUS[row.status]}</p>
                        <p>Start date {row.startsOn ?? "unavailable"} · End date {row.endsOn ?? "unavailable"}</p>
                      </li>
                    ))}
                  </ul>
                  {outcome.limited && <p>CareSource may have more records in its member portal.</p>}
                </>
              )}
              <a href="/medicaid">See Medicaid changes and renewal resources</a>
              {" "}
              <button type="button" className="coverage-clear" onClick={() => {
                resultRequest.current = null;
                setOutcome(null);
              }}>Clear coverage results</button>
            </div>
          )}
        </div>
      </section>
      <section className="page-panel coverage-directory" aria-labelledby="find-insurer">
        <h2 id="find-insurer">Find my insurer</h2>
        <p>Find official member resources for Ohio Medicaid and Medicare. Use the member portal to confirm your own enrollment.</p>
        <label htmlFor="coverage-insurer">Insurer or program name</label>
        <input id="coverage-insurer" type="search" placeholder="Try CareSource or Medicare" maxLength={100}
          value={query} onChange={event => setQuery(event.target.value)} />
        <ul className="coverage-directory-list">
          {resources.map(resource => (
            <li key={resource.name}>
              <a href={resource.href}>{resource.name}</a>
              <span>{resource.group}</span>
            </li>
          ))}
        </ul>
        {resources.length === 0 && <p role="status">No match in this directory. Check your insurance card for the member services number.</p>}
        <p><a href="/medicaid">Find another state’s Medicaid program</a></p>
      </section>
    </div>
  );
}
