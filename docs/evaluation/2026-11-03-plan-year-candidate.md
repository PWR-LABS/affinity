# [affinity.] — 2027 Marketplace candidate verification

Status: implemented and tested locally on the development branch; not merged or deployed. This record follows the [source-availability audit](../PLAN_YEAR_2027_READINESS.md) and does not replace its retained observations.

## Candidate behavior

Screening and plan comparison offer explicit 2026 and 2027 coverage years. The default remains 2026; the application does not advance it from the device clock. Income and age labels identify the chosen coverage year, successful API results echo it, and screening-to-plan navigation preserves it.

Oregon uses the federal path for 2026 and an official Explore Health handoff for 2027. Both the 21-state 2026 and 22-state 2027 marketplace lists are regression-tested across all 51 state/D.C. codes. Unknown or malformed years are rejected before source access, including direct engine calls. Federal eligibility, plan search, doctor autocomplete and provider/drug coverage use the requested year. Drug-name lookup remains independent of plan year.

Changing years clears old results and selected doctors. The doctor typeahead remounts for the new year. Request identities prevent an old result or error from reappearing after a year change, and a successful response with the wrong year is rejected. This is an addition to the existing UI; other product lanes and annual-care-cost claims remain unchanged.

## Verification and source identity

Runtime source checkpoint: **`082fb8748ab79c453d83bd522ada039fbcbb247c`**, branch `codex/2027-marketplace-support`. The Next production build was served only on loopback at `http://127.0.0.1:3217`, with build ID `HU5RZw1gXP6ExwPXI7Rbu`. No runtime source changed between that checkpoint and these source-pair runs. This is local Git/build evidence, not a platform deployment receipt. The local health route correctly had no Render release commit; the source-pair JSON's `liveCommit: unverified` is preserved.

Node 24.22.1 typecheck and `npm run build` passed. The deterministic regression bundle passed all **12 gates**, including **130 unit tests** and the **31-case fixture preflight**. The added tests check both routing lists, malformed/unsupported years, Oregon's different year paths, explicit transport years, default-year compatibility and safe larger-household handoffs.

| Check | Observation time, UTC | Result | Reduced evidence |
| --- | --- | --- | --- |
| 2027 eligibility source pair | 2026-11-03T18:50:42.996Z | 5/5 synthetic one-person profiles paired; 0 compared-field mismatches; 0 unavailable | [eligibility JSON](2026-11-03-plan-year-2027-eligibility-pair.json) |
| 2027 plan-board source pair | 2026-11-03T18:49:24.138Z | 2/2 synthetic profiles; 20/20 first-page source rows matched; 0 unavailable | [2027 plan JSON](2026-11-03-plan-year-2027-candidate-pair.json) |
| 2026 plan-board control | 2026-11-03T18:50:08.383Z | 2/2 synthetic profiles; 20/20 first-page source rows matched; 0 unavailable | [2026 control JSON](2026-11-03-plan-year-2026-candidate-control.json) |
| Browser journey | 2026-11-03T18:46:34.378Z | 7 checks passed with synthetic intercepted responses and an actual local Oregon handoff | [browser JSON](2026-11-03-plan-year-browser.json) |

These are separate denominators. The plan comparisons check year, geography, APTC, plan counts, source ID/name, metal, gross/net monthly premium, annualized premium and safely scoped cost-share fields for the sampled rows. The eligibility comparison checks the displayed routing/estimate fields. These are comparisons with the same CMS feed, not independent verification of network accuracy, all plans, actual care spending or enrollment benefit. No patient, applicant or UH record was used.

The headless Chrome browser checks cover visible year labels, Oregon's 2027 link, clearing a completed result, late eligibility and plan responses after switching years, retaining the selected year during navigation, year-specific doctor lookup and clearing, mismatched response rejection, and no horizontal overflow at 390px. Desktop and mobile screenshots were visually inspected locally. This is not a screen-reader, WCAG-conformance or intended-reviewer comprehension assessment.

Harness hashes (SHA-256), retained separately from runtime identity:

| Harness | Digest |
| --- | --- |
| `scripts/eval-plan-board-source-pair.ts` | `4f19f7d4c71d7d7ef74e9c669bc520f73b24b106f42fbbaef498a7b1989434a0` |
| `scripts/eval-marketplace-source-pair.ts` | `099bdffd0fa0265c5aeb7d20c792a560458904825e50762ba8823bddcad2f046` |
| `scripts/eval-plan-year-browser.cjs` | `a1b68bcc9ebaea33e84c9dce8d9597fa4712859dbac19c1bb1a4fca45e891f6b` |

The source-pair runners retain their production/2026 defaults and accept explicit `AFFINITY_EVAL_APP_URL` and `AFFINITY_EVAL_YEAR` overrides. The 2026 mixed-basis matrix now uses 2028 for its unsupported-year case; the old evidence with a rejected 2027 remains historical. The earlier availability runner's deployed-2027-rejection check describes the pre-enablement production boundary and must not be treated as an acceptance gate after deployment of this candidate.

## Cost implications

**Expected added fixed monthly infrastructure: approximately $0 at existing tiers and similar traffic.** This is an architectural estimate, not a measurement of the account's bill. The feature changes no Render service, compute tier, database schema/storage, LLM calls, or API credentials. It requests one selected year through the existing CMS endpoints; it does not run both years for each user or copy an additional year's catalog into a database.

[Render bills compute and usage](https://render.com/pricing), and the [CMS API has request-rate limits](https://developer.cms.gov/marketplace-api/api-spec). More visitors or larger returned plan lists can increase usage. In the earlier Ohio source audit, 119 plans for 2026 versus 132 for 2027 would require 12 versus 14 ten-plan search pages in the current board. That is two extra search calls for that synthetic case, plus corresponding coverage batches when doctors or medications are selected; it does not itself require another service. Development and validation effort is the main added work. No claim of a new paid API contract or verified future invoice is made.

## Publication boundary and remaining work

The public service was separately observed on the existing production commit `d2ec33ede083a548670e0fecce7f16b48d786a94`; these local results do not establish public 2027 availability. Before publishing, review the candidate and its year-selection behavior. After an authorized merge/deploy, verify the exact responding release, both year controls, Oregon handoff, deep health and source-pair results on that deployment. Existing terms, human-use/accessibility and UH governance questions remain separate.

The authorized Notion publisher owns the current live product doctrine, which is unchanged by this development candidate. No production configuration, Notion content or private canonical memory was changed. The pre-existing Medicare sweep was preserved. The temporary local server and isolated headless browser were closed after verification.
