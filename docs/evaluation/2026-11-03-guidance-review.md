# [affinity.] — guidance review and observation migration

This is the preserved initial checkpoint. The later [content review and source replacement](2026-11-03-guidance-completion.md) supersedes its current-status statements; the failed observations remain valid historical evidence.

## Outcome

**PARTIAL policy review; format-2 observation migration prepared on a feature branch.**
Five of seven watched sources were retrieved and fingerprinted successfully. Both
New York articles returned HTTP 403. The complete policy-review date remains
September 28, 2026, detailed summaries remain withheld, and
[review issue #4](https://github.com/PWR-LABS/affinity/issues/4) remains open.
No merge, deployment, policy-text change, or issue closure is part of this checkpoint.

## Evidence and provenance

The source checkout started at `15d654825a5b2aa1a8803af4483e3d2fe0c0e7f1`.
The local watcher ran on the Mac mini under Node 24.22.1 at
2026-11-03T22:13:03.393Z and repeated at 2026-11-03T22:13:25.231Z
(5:13 p.m. America/New_York). These are retrieval times, not source publication
dates or a new policy-review date. The independent web-reading route was also
used to examine the available official source text and publication listings.

The [before report](2026-11-03-guidance-review-before.json) preserves the legacy
baseline result. The [after report](2026-11-03-guidance-review-after.json) records
the repeat against the migrated baseline. Reduced reports contain URLs, statuses,
hashes and timestamps, with no raw source bodies, credentials or household data.

| Source | Observed transport | Content review disposition |
| --- | --- | --- |
| `renewals` | 200; repeat hash unchanged | Supported: the current card distinguishes expansion adults from all members and retains state-notice instructions. |
| `community-engagement` | 200; repeat hash unchanged | Supported as a bounded overview, not a complete enumeration of qualifying routes or exemptions. |
| `NY-0` | 403; no hash | Unverified. The continuous-coverage claim was not reapproved. |
| `NY-1` | 403; no hash | Unverified. The August–September notice claim was not reapproved. |
| `OH-0` | 200; repeat hash unchanged | Supported with the existing federal-law qualification. |
| `policy-publication-index` | 200; repeat hash unchanged | First page of the official listing inspected; this is discovery evidence, not an exhaustive search of every publication. |
| `state-contact-directory` | 200; repeat hash unchanged | Official directory retrieved; individual application/renewal destinations were not comprehensively revalidated. |

## Source-to-claim review

- **Federal renewals:** [CMS SMD 26-001](https://www.medicaid.gov/federal-policy-guidance/downloads/smd26001.pdf), published March 6, 2026, supports the six-month schedule for most expansion adults with applicable renewals beginning January 1, 2027. Pages 1 and 4–6 distinguish affected groups, exemptions, existing renewal procedures and transition timing. The current card's limited scope and notice-based action remain supported; no individual renewal date was inferred.
- **Community engagement:** the [CMS June 1, 2026 fact sheet](https://www.cms.gov/newsroom/fact-sheets/medicaid-community-engagement-requirement-certain-individuals-interim-final-rule-comment-period-cms) supports the general implementation timing, qualifying activities and existence of exemptions. Its income route and detailed exceptions go beyond the short card. The [current CMS topic page](https://www.medicaid.gov/resources-for-states/working-families-tax-cut-legislation/community-engagement) still links the rule and includes September medical-frailty material. This review does not determine any person's obligations or certify every state's implementation.
- **Ohio:** [Ohio Revised Code 5163.11](https://codes.ohio.gov/ohio-revised-code/section-5163.11), effective September 30, 2025, supports the card's qualified six-month redetermination statement. The federal timing and community-engagement sentences depend on the separate federal sources above, not this state statute alone.
- **New York:** the linked [June article](https://www.health.ny.gov/health_care/medicaid/program/update/2026/no07_2026-06.htm) and [July article](https://www.health.ny.gov/health_care/medicaid/program/update/2026/no08_2026-07.htm) were unavailable through both the local watcher and web reading. Official publication-index search results identify the editions but do not establish their full contents. PDF alternatives could not be read. No search snippet, third-party paraphrase or prior review was substituted for current article text. A 403 here does not establish that the public site is down or inaccessible to a person using a browser.

## Migration contract and validation

`guidance-observations.json` now explicitly identifies fingerprint format 2 and
keeps `policyReviewNotRenewed: true`. Five hashes were computed from the successful
observations; the two unavailable New York records retain null hashes. The old
baseline is preserved in Git at the starting commit. No legacy hash is relabeled
as format 2, and no failed response is accepted as reviewed content.

The repeat returned five `unchanged_observation` results, two `http_error` results,
`reviewOverdue: true` and `needsReview: true`. There were no remaining
`baseline_refresh_required` results among the successfully observed sources.
The existing unit suite passed **149/149** under Node 24.22.1, including tests that
matching hashes cannot renew policy review. A premature watcher invocation during
dependency installation failed because `tsx` was not yet available; after locked
`npm ci` completed, both recorded watcher runs succeeded. No runtime application
code or policy date changed; a production build was not needed for this data-only
observation checkpoint.

Typecheck also passed. A focused integrity check verified that the baseline is
the exact successful/null source set from the before report, recomputed both
report fingerprints, confirmed the two 403/null records, and checked with the
real clock that the policy gate remains closed.

## Remaining work

Retrieve the two complete New York articles through an available official route
and compare the actual state claims, including the now-past notice window, with
current guidance. Only after the full content review should a separate change
update policy wording and the reviewed date. Observation migration alone cannot
finish that review or close issue #4.

The draft remains separate from the deployed baseline until merge. The bot-owned
issue is intentionally untouched; its next ordinary workflow run will report the
baseline it actually uses. Future scheduled execution and an actual automatic
catalog renewal remain separate, unobserved events. No workflow was dispatched to
imitate a cron run. The keeper-owned product doctrine is unchanged, so Notion sync
is not applicable to this evidence/data slice.
