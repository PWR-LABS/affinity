# Employer evidence safety — candidate, November 4, 2026

An employer identifier with any indexed files previously turned a missing provider into a definitive negative coverage answer. The index does not preserve a complete-file inventory or certified publication receipt, so that inference was unsupported. Positive results could also carry old or missing source dates.

This candidate changes the full lookup path without a database migration:

- No current TiC lookup emits `no`. An unmatched provider remains `unknown`, including when some files for the identifier exist. The reconciler cannot turn that unknown into corroboration or disagreement.
- A match is eligible only when its source date is within the preceding 60 days, inclusive, and not in the future. This is a conservative beta application policy, not a regulatory requirement or guarantee of coverage. A query timestamp never renews a source date.
- The response carries `evidenceStatus` and a plain-language explanation: `listed`, `plan_missing`, `incomplete_index`, `source_stale`, or `source_date_unknown`. Positive answers say “listed in an issuer file” and explain that an employer identifier may span plans. Source URL and date come from the same matching file.
- Readiness requires a recent file with both provider memberships and plan links. Independent nonempty tables cannot pass. Availability means recent listings exist somewhere, not comprehensive coverage. Plan search applies the same rule; direct API requests still fail closed on stale evidence.
- The browser distinguishes the reasons for unknown results, points to insurer/provider confirmation, and clears answers when the doctor or plan changes. A delayed response cannot restore an obsolete answer.

## Verification

- 160 unit tests passed; all 13 production-readiness gates passed.
- Type checking and the optimized production build passed.
- The [end-to-end receipt](2026-11-04-employer-evidence-safety.json) records seven checks using a dedicated loopback PostgreSQL database, real Prisma queries and HTTP handlers, and headless Chrome against the production build. It covers positive and unknown answers, source/date provenance, plan search, joined readiness, request races, and a 390px mobile viewport. No browser page errors or horizontal overflow were observed.
- The mobile stale-result screenshot was visually inspected; it is a local test artifact, not a production screenshot.
- Initial test-harness assertions were corrected for the existing single-source confidence discount and CSS-uppercase labels; the final runs above passed.

The browser evaluator is `scripts/eval-employer-browser.cjs`. It requires `DATABASE_URL` pointing to the dedicated loopback database named `affinity_employer_e2e`, `AFFINITY_EVAL_APP_URL` pointing to a loopback candidate app using that same database, and Playwright (optionally through `AFFINITY_PLAYWRIGHT_MODULE` and `AFFINITY_CHROME_PATH`). Initialize an isolated PostgreSQL cluster, apply the existing Prisma schema, build/start the app with that database URL, and run the script. It deletes only synthetic TiC records in that explicitly named database, closes its browser, and disconnects. Stop the candidate app and isolated cluster afterward. Never use a production database or an unrelated developer database.

## Verified production impact and remaining boundary

A read-only production inventory on November 4 found 317 TiC files, newest source date July 1, 2026, and zero within 60 days. Therefore deploying this candidate will withhold the employer checker and show “Recent employer sources unavailable.” Direct API calls will return unknown for those old sources; plan search will omit them. This accurately reflects the current data, not a database outage.

Refreshing source data, certifying full plan inventories, atomic publication, and enabling negative answers are separate work. Medicare behavior is unchanged. This candidate does not refresh the database, add coverage, or claim that an issuer-file listing proves a particular plan's network status.

Git publication is not production activation. Merge/deployment and production response readback remain pending. The keeper-owned product doctrine is unchanged in this candidate; its release description and Notion mirror must be reconciled through the existing keeper path when activation is authorized. No infrastructure, production database, or Notion mutations were made during candidate verification.
