# [affinity.] — freshness updater

Operator requirement, November 3, 2026: the product must detect and handle annual/source changes rather than silently become an outdated source itself. This implementation is prepared on the development branch; the scheduled workflow and public behavior require the initial reviewed merge/deployment before they can be claimed live.

## Automatic Marketplace updates

The application reads a strictly validated data catalog, not hardcoded year lists or a clock-based year switch. Its year choices, default, state routing and exchange links come from `src/lib/marketplace/catalog-data.json`. The official current year is the default only after its catalog and availability probes pass. Initial direct CMS checks accepted 2026 and 2027 with 2027 current.

Daily at 09:23 UTC, the GitHub Actions workflow:

1. Reads the official `/market-years` and year-specific `/states` API endpoints using the existing Marketplace key. The 50 states and D.C. must each appear exactly once with a known platform model; full state exchanges must have usable HTTPS handoffs. Territories are outside this app's scope.
2. Rechecks accepted years, the official current year and an advertised next year. Five fixed synthetic one-person profiles per year check unique geography, usable eligibility fields and one ten-plan source page. An advertised next year with incomplete data is deferred; it does not get enabled or prevent checks of already accepted years. A failure in an accepted/current year preserves the previous catalog and fails the run.
3. Validates the generated data, typecheck, the deterministic regression bundle and build. Metadata, links or accepted-year changes publish promptly. Unchanged data do not cause daily commits; the receipt renews after six days. Each accepted receipt expires after eight days.
4. If `AFFINITY_SOURCE_AUTO_PUBLISH=true`, publishes **only** the catalog JSON to `main`. The publisher rejects other changed paths, other repositories/branches/events, a moved remote base, mismatched content hashes and expired receipts. It uses a normal push; branch restrictions and authentication failures are not bypassed. Otherwise it creates a review proposal. Neither mode can rewrite executable code or policy text.
5. Verifies the responding production commit, catalog receipt/default/years, deep API health, five eligibility source pairs, two-profile sampled plan source pairs and Oregon's route. A successful Git push is not a successful site update. Source-pair results and the final responding release are retained separately; a changed release or failed deploy fails verification.

The workflow runs on cloud infrastructure independently of the Macs. Actions use pinned official action commits and minimum job-level permissions. API credentials are passed only to official-source/verification steps. The updater never persists keyed URLs, raw responses, household records or credentials.

The daily schedule can be delayed or disabled by GitHub, and upstream services or credentials can fail. Freshness enforcement does not assume that a scheduled job ran successfully. New schema/models, accepted-year failures, more than five retained years, or compatibility regressions require review; the updater must not invent a repair merely to stay green.

## Runtime protection

`/api/freshness` reports year/routing receipt age separately from policy review and indexed-source freshness. `/sources` explains those limits to users, and the footer shows the published year/routing check date. Quotes still request live Marketplace data per search; a fresh routing receipt is not independent verification of provider or formulary claims.

At catalog expiry—or if the receipt appears to come from the future—the app stops producing eligibility estimates, plan quotes and provider suggestions from that catalog. Screening returns a no-estimate official handoff; plan/provider routes return an explicit unavailable status. The stale screening UI uses national official directories rather than presenting stored state links as newly verified. Application liveness remains separate so an overdue receipt does not cause a meaningless restart loop.

## Policy and contact changes

A separate daily job watches seven official sources: the federal guidance documents, New York/Ohio source pages, Medicaid's policy-publication index and its state-contact directory. The publication index matters because a replacement document can appear while an old URL stays reachable. HTML main-content or PDF fingerprints detect drift; network, HTTP and parsing failures remain distinguishable. Fingerprints are observations, not approval of policy meaning or completion of an application path.

`guidance-observations.json` is an initial observation baseline and explicitly does not renew a policy review. The last recorded policy review is September 28, 2026; under the new 30-day review window, detailed federal/state policy summaries are now withheld in the candidate in favor of official sources. Updating a fetch timestamp cannot make them reappear. The initial watch retrieved five sources and left two New York observations inconclusive; it does not establish those sites are down.

Changes, unavailable/unparsed content or an overdue review create or update one bot-owned review issue. An unchanged report does not send repeated messages. After a real source/meaning review, update the guidance and its reviewed date and explicitly replace the observation baseline; do not automatically accept the changed fingerprint. The monitor closes its own issue when the review condition is resolved.

This does not automatically ingest employer/TiC or Medicare Part D indexes, validate all state application/renewal paths, or certify policy correctness. Those remain separate source contracts; the freshness endpoint explicitly leaves indexed coverage uncertified. No blanket “the entire site is current” claim is justified by this job.

## Configuration and validation

Required repository secret: `MARKETPLACE_API_KEY`. The encrypted GitHub secret uses the existing key, not a second Marketplace subscription. Repository variable `AFFINITY_SOURCE_AUTO_PUBLISH` selects narrow automatic catalog publication; false/unset selects review proposals. The schedule runs only from `main`; adding the workflow on a feature branch does not activate it. Existing Render `main` auto-deploy remains the delivery path.

```bash
node --env-file=.env --import tsx scripts/update-marketplace-catalog.ts
npm run watch:guidance
npm run typecheck
npm run eval:production-readiness
npm run build
```

The fixture-only unit/preflight commands freeze their clock to the catalog's observation time. That makes historical fixture tests deterministic without weakening production expiry checks; live refresh and browser checks use the real clock. Tests cover future-year discovery, incomplete/unknown sources, empty successful responses, ambiguous counties, secret-safe failures, next-year deferral, receipt renewal, expiry handoffs, publication scope and deployment readback.

The initial [verification record](evaluation/2026-11-03-freshness-updater.md) retains source-check dates, the catalog hash, unresolved observations, test results and the pending activation boundary.

There is no new paid server or database in this design. The schedule consumes API requests, GitHub runner time and occasional Render builds; costs depend on the account's allowances and usage. Routine price retrieval already happens per request, so prices are not copied into a yearly database.
