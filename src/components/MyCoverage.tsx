"use client";

import { useState } from "react";

import { findOhioCoverageResources } from "@/lib/insurers/ohio-insurers";

export function MyCoverage() {
  const [query, setQuery] = useState("");
  const resources = findOhioCoverageResources(query);

  return (
    <div className="my-coverage">
      <section className="page-panel coverage-connect" aria-labelledby="caresource-coverage">
        <h2 id="caresource-coverage">CareSource Ohio Medicaid</h2>
        <p>Sign in with CareSource to check your current plan and coverage dates.</p>
        <a href="https://mylife.caresource.com/">Open CareSource member portal</a>
      </section>
      <section className="page-panel coverage-directory" aria-labelledby="find-insurer">
        <h2 id="find-insurer">Find my insurer</h2>
        <p>Find official member resources for Ohio Medicaid and Medicare. Use the member portal to confirm your own enrollment.</p>
        <label htmlFor="coverage-insurer">Insurer or program name</label>
        <input id="coverage-insurer" type="search" placeholder="Try CareSource or Medicare" maxLength={100}
          value={query} onChange={event => setQuery(event.target.value)} />
        {resources.length ? (
          <ul className="coverage-directory-list">
            {resources.map(resource => (
              <li key={resource.name}>
                <a href={resource.href}>{resource.name}</a>
                <span>{resource.group}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status">No match in this directory. Check your insurance card for the member services number.</p>
        )}
        <p><a href="/medicaid">Find another state’s Medicaid program</a></p>
      </section>
    </div>
  );
}
