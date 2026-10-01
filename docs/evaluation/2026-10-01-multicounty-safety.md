# [affinity.] multi-county ZIP safety replay — October 1, 2026

Status: technical guard verified on a synthetic profile; **not** a UH pilot authorization, county-selection feature, or enrollment test.

## Why this guard exists

The [CMS Marketplace API](https://developer.cms.gov/marketplace-api/api-spec) can return multiple counties for one ZIP. Direct read-only source lookups returned Harris and Fort Bend counties for Texas ZIP **77449**, and Oklahoma and Cleveland counties for Oklahoma ZIP **73102**. Taking `counties[0]` would silently choose a rating area that the person did not specify. The live screening and plan board now refuse to produce a federal subsidy or plan comparison from that arbitrary first choice.

## Verification on the deployed code

- Responding production code at test time: `f464212dd8dc91cb2447d42107f2f87a42881135` on `main`, observed through `/api/health`; deep health reported app, database, and Marketplace API `ok` and key `present`.
- Synthetic one-person Texas 77449 request: eligibility returned `official_handoff`, `aptcMonthly: 0`, no plan count, and an explicit instruction to confirm county at the official Marketplace. Plans returned HTTP 409 with `code: county_ambiguous` and an official-Marketplace route. No applicant or patient information was used.
- Live browser replay of the same synthetic plan request visibly brought the error and HealthCare.gov link into view after submission; focus remained on the submit button. This is a bounded visual/keyboard observation, not a screen-reader audit.
- Pure county-resolution tests covered unique, repeated-identical, same-state ambiguous, cross-state, mismatched-state, and missing-source candidates. The synthetic routing preflight passed **31/31** fixture cases, including both ambiguous eligibility and plan-board branches.

## Source-paired matrix and correction

The first [same-code live matrix](./2026-10-01-pilot-live-matrix-after-county-guard.json) evaluated 30/30 cases but reported one difference: its old `ok-federal-platform` case treated Oklahoma ZIP 73102 as if CMS's first county were the only county and expected a $202 monthly credit. The app correctly returned an official handoff. That failed report is retained, not erased.

After the source lookup confirmed both Oklahoma and Cleveland counties, the evaluator classified this case as `direct_cms_ambiguous` and checked for the no-estimate handoff instead of computing a first-county subsidy. The [reclassified repeat](./2026-10-01-pilot-live-matrix-after-county-guard-reclassified.json) evaluated **30/30, 0 mismatches, 0 unavailable** on the same deployed code: 11 direct-CMS full comparisons, two direct-CMS ZIP/state geography checks, one direct-CMS multi-county check, eight CMS exchange-list classifications, four safety-contract cases, and four validation cases. This is a corrected test expectation grounded in the source geography, not a suppressed app defect.

A [same-deploy plan-board repeat](./2026-10-01-plan-board-source-pair-final.json) compared **2/2 synthetic profiles and 20/20 first-page plan rows**, with zero profile or row mismatches. It remains a bounded same-feed check; coverage truth, all plan rows, human comprehension, and full annual care cost are outside its scope.

At this checkpoint, the full `eval:production-readiness` bundle passed 12 gates with the 31-case preflight, the production build passed, and `npm audit --audit-level=moderate` returned **0 reported vulnerabilities** after the three build-time transitive packages were patched. The audit is a package-advisory check, not a security assessment.

## Remaining pilot gates

The safe fallback is not a county picker. A person with an ambiguous ZIP must identify their county on HealthCare.gov. Before an intended-user or UH-sponsored pilot: verify the official action path and phone context for each relevant state, run screen-reader and intended-reviewer comprehension sessions, resolve Marketplace API terms/attribution, refresh any out-of-year source/routing data, and obtain UH ownership, security, privacy, accessibility, hosting, and research/operations approvals. No real UH or patient records were entered here.
