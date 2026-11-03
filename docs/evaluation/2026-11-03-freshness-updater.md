# [affinity.] — freshness updater verification

The automatic updater and runtime expiry protections are implemented on the development branch, tested locally and prepared for initial review. They are **not active in production**. The [reduced evidence](2026-11-03-freshness-updater.json) binds the local checks to runtime source commit `476de5a48a8d228f17d5142e1fd8410572d6ad49` and records the separately observed public release.

## Observed behavior

The application now derives supported years, the default year, state platform models and official exchange handoffs from a strictly validated CMS catalog. The initial catalog contains all 51 jurisdictions for 2026 and 2027, with 21 and 22 own-platform exchanges respectively. CMS advertises 2027 as current; the candidate therefore defaults to 2027. Oregon is a federal-platform state in 2026 and a state-platform handoff in 2027.

The catalog was checked at `2026-11-03T19:27:39.629Z` and expires eight days later. Its SHA-256 is `7cd02ae1c3bff878980189582b000fab0a54962f3e1f21e9918da5994d2c0db7`. A second live check at `2026-11-03T19:46:51.695Z` passed all ten fixed year/profile probes and produced `changed: false`; it did not rewrite the accepted receipt or file. The report's candidate hash belongs to that unneeded newer receipt, not to the published catalog bytes.

The policy observer retrieved five sources with unchanged normalized content and received HTTP 403 from both New York source pages. Those responses remain an unresolved observation, not proof that the pages are unavailable to people. The actual policy review remains September 28, 2026. It is overdue under the new 30-day review window, so detailed federal/state summaries are withheld in the candidate while official links remain available.

## Verification

- Node 24.22.1 typecheck and production build passed. Page rendering evaluates receipt age per request; an initially successful build cannot freeze the banner's status indefinitely.
- All 12 deterministic regression gates, 141 unit tests and the 31-case routing preflight passed. The fixture-only commands use a catalog-relative clock; runtime, live source refresh and browser checks use the real clock.
- Nine headless browser checks passed. They cover explicit years, Oregon's real local handoff, late/mismatched responses, doctor selections, year-preserving navigation, 390px overflow, the source-status page and withholding overdue policy details while retaining state handoffs. The mobile source page was visually inspected. This does not certify accessibility or user comprehension.
- Expiry tests exercised the actual API routes: no upstream requests, a no-estimate official screening handoff, and 503 responses for plan/provider requests. Future-year, incomplete-source, empty-success, ambiguous-geography, source-error redaction, receipt-renewal, publication-scope and deployed-release identity checks also passed.
- The two-job workflow parsed successfully; the publication, notification and deployment-readback scripts passed syntax checks. Scoped files passed a local credential-exclusion check.

## Activation and remaining boundaries

The existing Marketplace key was stored as an encrypted GitHub Actions repository secret, and `AFFINITY_SOURCE_AUTO_PUBLISH=true` was read back. Actions and issues are enabled. The daily 09:23 UTC workflow is restricted to the repository's default branch; it cannot run on this feature branch. Neither the first scheduled execution nor candidate deployment verification has occurred.

After an authorized initial merge/deploy, routine validated changes may publish only `src/lib/marketplace/catalog-data.json`. The job must verify the actual responding release/catalog and repeat bounded live source pairs. Failed source checks, a moved branch base, a failed deployment or an incompatible source schema remain failures. The [updater contract](../FRESHNESS_UPDATER.md) defines the receipt window, renewal timing, policy-review path and limited publication authority.

Git publication does not complete the main-only Notion keeper sync; the changed doctrine requirement remains pending that path. No merge, deployment or Notion update was performed. The temporary loopback server and isolated headless browser were closed; the pre-existing Medicare sweep was preserved.

This is automatic maintenance of a defined Marketplace catalog plus policy-source monitoring. It does not certify every policy, independent provider/formulary coverage, all state application/renewal paths, employer/TiC indexes or Medicare Part D ingestion. Those require their own evidence and update contracts. No new paid service or database was introduced; API requests, runner time and Render builds still consume the existing account's allowances.
