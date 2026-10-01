# [affinity.] live Marketplace source-pair method check — October 1, 2026

Five prewritten, one-person synthetic 2026 profiles were submitted to the live [affinity.] eligibility endpoint and separately queried against the [official CMS Marketplace API specification](https://developer.cms.gov/marketplace-api/api-spec). The same-day direct CMS response was independently reduced to the fields shown by [affinity.]. Full case inputs, source values, app values, timestamps, and field-level differences are in [the machine-readable run](./2026-10-01-marketplace-source-pair.json).

- Run: 2026-10-01T18:08:53.676Z; live [affinity.] deployment `dep-dava13m417fc73ds15ug` at commit `62364282860ca17cc6b90870830c18ee716a597f`.
- Denominator: 5 planned synthetic profiles; 5 paired successfully; 0 had a compared-field mismatch; 0 were unavailable.
- Compared fields: state, county, Medicaid estimate flag, rounded monthly APTC, coverage-gap flag, official plan count, cheapest **gross monthly premium among only the first 10 returned plans**, and the route verdict derived from those source fields.

| Synthetic case | Source-derived route | APTC / month | Plan count | Cheapest first-page gross premium / month | Field differences |
| --- | --- | ---: | ---: | ---: | ---: |
| oh-low-income | medicaid | 0 | 119 | 354.35 | 0 |
| oh-mid-income | marketplace | 324 | 119 | 557.60 | 0 |
| fl-low-income | coverage_gap | 0 | 189 | 479.72 | 0 |
| tx-mid-income | marketplace | 271 | 119 | 423.15 | 0 |
| wi-high-income | marketplace | 0 | 48 | 749.15 | 0 |

This is a **method check**, not the 30-profile evaluation: five cases do not establish national coverage. Both [affinity.] and this direct check rely on the **same CMS feed**; agreement validates this transformation and live plumbing, not independent plan accuracy, provider participation, formulary status, eligibility, or enrollment. No plan-board per-plan figures, annualized premium, or user comprehension were checked here. No UH or patient data was used. Monetary values are synthetic-profile estimates, not quotations for a real person.

Follow-up: the [30-case live eligibility matrix](./2026-10-01-pilot-live-matrix.md) now covers federal, state-marketplace, household, and invalid-input branches with distinct evidence bases. Upstream outage remains fixture-only. Per-plan fields, annualized premium, human comprehension, and accessibility still require separate checks under [the evaluation protocol](../PILOT_EVALUATION.md).
