# [affinity.] — November 3 Medicaid content review

## Decision and scope

The displayed federal, New York and Ohio summaries were reviewed on November 3,
2026. The New York card now covers 2027 preparation using readable official
sources. The complete content-review date advances to November 3, independently
of the observation timestamp; the existing 30-day expiry remains in force.

This completes review of the **displayed summaries**, not certification of all
Medicaid policies, individual eligibility, application/renewal completion, or all
51 state contact paths. Individual state notices still govern next steps.

## Why the New York card changed

The June and July New York newsletters still returned HTTP 403 through the
available reading routes. Their [initial failed observations and partial review](2026-11-03-guidance-review.md)
are preserved. Search-index snippets were not substituted for full source text.
The broad continuous-coverage claim and prediction of August–September notices
were withdrawn from the card, not marked verified or declared false. Neither is
needed for the narrower preparation guidance now displayed.

The replacement sources are official public guidance that was read in full:

- [NYC Health preparation PDF](https://www.nyc.gov/assets/doh/downloads/pdf/hca/medicaid-work-requirements.pdf), marked October 2026: supports the upcoming requirements, exemptions, preparation steps, and the existing-member renewal timing stated on page 2. The card attributes that timing to NYC Health and defers to the individual's notice. It does not suggest everyone's coverage changes on January 1.
- [CMS New York eligibility guide](https://www.medicaid.gov/renew-info/NY): supports the limited affected population, exclusions, current contact information, attention to official notices and contacting the state for clarification. This guide is not treated as a substitute for a state eligibility decision.

The [NYC Health October 1 announcement](https://www.nyc.gov/site/doh/about/press/pr2026/support-for-nyers-impacted-by-new-federal-medicaid-requirements.page)
also distinguishes new applicants from current members and records notices as
already sent. The [state Office of Mental Health overview](https://omh.ny.gov/omhweb/hr-1-changes/)
corroborates the 2027 requirement and links to state resources. These were
corroborating review materials, not additional claims of statewide process testing.
The consumer card directly links the PDF and CMS guide, both of which the watcher
can parse without relaxing its main-content requirement or bypassing access errors.

## Federal and Ohio review

The [initial source-to-claim review](2026-11-03-guidance-review.md#source-to-claim-review)
supports the unchanged federal and Ohio summaries from the CMS renewal letter,
CMS community-engagement fact sheet and Ohio statute. Their qualifications remain:
the renewal rule covers most expansion adults, community engagement has a
different scope and exemptions, and Ohio's statute is qualified by federal law.
The short cards are overviews rather than exhaustive eligibility rules. The
federal publication index and state-contact directory remain watched for changes;
their successful retrieval does not certify every outbound destination.

## Observation and verification

The [revised-source run](2026-11-03-guidance-revised-sources.json) retrieved all
seven active sources successfully and identified the two new New York sources as
first observations. After explicitly establishing their format-2 baseline, the
[repeat](2026-11-03-guidance-reviewed-repeat.json) returned seven
`unchanged_observation` results, `reviewOverdue: false` and `needsReview: false`.
Both runs retain their UTC observation times and exact URLs/hashes. The baseline's
`policyReviewNotRenewed: true` still means that the hashing operation itself does
not renew content review; the separate reviewed content change above does.

On Node 24.22.1, all **150 unit tests and 13 readiness gates** passed. The source
watch tests now use offsets from the declared review date, so they continue to
exercise current and overdue windows after future reviews. A new boundary check
verifies expiry at exactly 30 days and rejection of future review dates. Link-only
change detection and the rule that matching hashes cannot renew review remain
covered. Typecheck and production build also passed. A local production-server
check verified the review date, rendered summaries and replacement links, and
confirmed the obsolete claims/links and overdue warning were absent. Responding
public-release checks belong to the delivery receipt; a source review or Git push
alone does not prove deployment.

The bot-owned review issue is resolved only if its actual main-branch cloud run
finds no remaining review condition. An upstream failure or source drift keeps
that issue open even with a current content-review date. A manual verification
run does not count as observation of the future daily cron or an automatic catalog
renewal. No changes to account access, credentials or the publication contract
are needed for this release.
