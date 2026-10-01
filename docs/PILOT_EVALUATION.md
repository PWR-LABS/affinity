# [affinity.] Outside-In evaluation protocol

Status: proposed, non-confidential. This document is a reproducible evaluation plan, not a UH pilot authorization or evidence of clinical benefit.

## First use case

Evaluate whether an adult who may be leaving Medicaid can identify the correct official next step and interpret a federal Marketplace plan comparison without mistaking source-reported coverage or annualized premium for a guarantee. Keep the initial test to synthetic, one-person 2026 profiles. Do not enter UH or patient records.

Plan year is a safety boundary: the public comparison and exchange map are currently certified for **2026 only**. Eligibility, plan-search, and provider-lookup APIs reject other years. A 2027 evaluation must first refresh exchange classifications (including Oregon's planned transition), source figures, links, and tests rather than reuse the 2026 routing table.

## What is available for evaluation

- Official Medicaid application pages or program portals for all 50 states and D.C.; renewal may require a different state-specific path.
- Federal Marketplace screening and plan comparison in supported states, with net monthly and annual premium, deductible, out-of-pocket maximum, and Marketplace-reported provider and drug matches.
- Source labels, uncertainty language, and an instruction to confirm coverage with the insurer and provider before enrollment.
- A public privacy and data-flow explanation. No accounts or saved household profiles.

The public ACA board has one coverage source. The tested issuer-file reconciliation, A-F grade, and fuller annual care-cost engine are **not** live consumer features. Employer and Part D verification require their indexes to be loaded and are outside this first evaluation.

## Automated preflight already available

Run `npm run eval:pilot-preflight` before freezing a candidate deployment. It exercises 31 synthetic route and validation cases using an injected Marketplace transport, plus plan-board failure-log and ambiguous-county checks. It covers state-marketplace and larger-household handoffs, federal estimate branches, ZIP errors and ambiguity, upstream outage behavior, and rejected inputs. It does not make live CMS requests or verify official state links, current plan figures, comprehension, or accessibility. Its 31 fixture cases are **not** the 30-case mixed-basis live matrix below.

The [October 1 Medicaid handoff audit](./evaluation/2026-10-01-medicaid-handoffs.md) probed all 51 configured state/D.C. links and compared them with the current CMS directory. It documents one corrected California destination; browser follow-up rendered the five automated-probe exceptions and led to two applicant-help phone corrections. A repeatable phone comparison initially found 48/51 app numbers also listed by CMS; an Ohio-specific application/renewal correction changed that to 47/51, with all four differences explained against state sources. All 14 alternative configured URLs were then opened in a browser and showed relevant official entry pages. Other phone contexts and downstream application/renewal action paths still require semantic review. Browser reachability and CMS URL agreement do not establish that a person can complete an application; human click-through and the source-paired profiles below remain open.

A separate [five-case live Marketplace source-pair method check](./evaluation/2026-10-01-marketplace-source-pair.md) matched the app's eligibility fields to direct CMS API responses for five synthetic profiles. It does not replace the 30-profile matrix or the per-plan, comprehension, and accessibility checks below.

The original [30-case live eligibility matrix](./evaluation/2026-10-01-pilot-live-matrix.md) covered 12 direct CMS full comparisons, two CMS county/ZIP-state checks, eight 2026 state-exchange classifications, four multi-person safety handoffs, and four validation cases. Its earlier complete retry had 30/30 evaluated and no compared-field difference. A subsequent [multi-county safety replay](./evaluation/2026-10-01-multicounty-safety.md) found that one of those purported full-comparison ZIPs spans two counties; the retained initial replay showed the old evaluator disagreeing with the safer app. The source-corrected same-deploy repeat had 30/30 evaluated with zero mismatches across 11 direct CMS full comparisons, two ZIP/state checks, one direct CMS multi-county check, eight exchange-list classifications, four safety handoffs, and four validation cases. The evidence bases remain separate. This does not complete full per-plan, outbound-action, comprehension, accessibility, or governance checks.

A [two-profile live plan-board source pair](./evaluation/2026-10-01-plan-board-source-pair.md) compared 20 first-page plan rows with direct CMS responses and found no compared-field differences, including premium annualization. It is a bounded same-feed check, not a full plan catalog or human-use validation. Exact live deploy SHA was not independently established **during that run**. The [subsequent live release receipt](./evaluation/2026-10-01-live-release-identity.md) verified the responding service's commit against remote `main`; the [multi-county replay](./evaluation/2026-10-01-multicounty-safety.md) repeated this source pair against an exact observed production code SHA. A final pilot candidate must still repeat that check at freeze time.

After the [cost-share scope guard](./evaluation/2026-10-01-cost-share-safety.md), a [new live source-pair replay](./evaluation/2026-10-01-plan-board-source-pair-after-guard.json) evaluated 2/2 synthetic profiles and 20/20 first-page plan rows with zero mismatches. The exact code commit was observed on the public health route and the deep health check passed. This still does not validate every CSR/source variant or complete a pilot freeze.

A [bounded keyboard and mobile-width journey](./evaluation/2026-10-01-keyboard-responsive-journey.md) found and corrected post-submit focus loss and an overbroad result announcement. The fix was retested on its exact live code commit with synthetic inputs. It is not a screen-reader or WCAG conformance audit; intended-reviewer comprehension and assistive-technology testing remain open.

The [2026 Marketplace platform parity check](./evaluation/2026-10-01-marketplace-platforms.md) found and corrected Illinois routing: CMS lists Illinois among the 21 full state exchanges for 2026. The deployed synthetic Illinois handoff check passed in the 30-case live matrix.

## Synthetic evaluation sequence

1. Freeze the deployed Git commit, plan year, official source URLs, test date, and expected outputs. Use synthetic profiles only.
2. Exercise every state and D.C. handoff link, plus at least 30 prewritten profiles spanning Medicaid-likely, Marketplace-subsidy-likely, no-subsidy, state-based Marketplace, ZIP ambiguity, multi-person handoff, missing data, and upstream failure. Compare routing and source figures with the official service on the same day where an official source is available. The current 30-case live matrix includes one direct-source multi-county ZIP and two ZIP/state disagreement cases; upstream failure remains fixture-only pending controlled staging fault injection. Outbound-link reachability does not establish application completion.
3. For supported Marketplace profiles, record each displayed plan's source identifier, quote year, monthly and annual net premium, deductible, out-of-pocket maximum, and selected provider/drug statuses. Treat missing source fields as unknown. Recalculate annual premium as 12 times the displayed monthly figure; do not call it total annual cost.
4. Have a small group of intended non-patient reviewers attempt the journey. Ask them to identify the official next step, explain what a source-reported match means, and name what they would confirm before enrollment. Record task completion and misunderstandings, not just satisfaction.
5. Repeat a subset on desktop, mobile, keyboard-only, and screen reader. Track defects against WCAG 2.2 AA as an accessibility target; do not claim conformance from an automated scanner alone.
6. Review the error and privacy logs for the evaluation window, then document every discrepancy with a reproduction and disposition.

## Proposed acceptance and stop rules

- **Route safety:** every tested state handoff points to the intended official service; no synthetic unsupported-state or multi-person case receives a fabricated federal estimate.
- **Claim safety:** zero displayed guarantees of provider participation, formulary coverage, eligibility, or full annual care cost. Unknown data remain visibly unknown.
- **Cost-share scope:** an in-network individual deductible or out-of-pocket figure must have explicit combined medical-and-drug source scope and an unambiguous amount. Otherwise show unknown, not a family, out-of-network, or first-listed variant. See the [cost-share guard](./evaluation/2026-10-01-cost-share-safety.md).
- **Privacy:** no participant or patient data; no health/income/search terms in [affinity.] request URLs; no intentional storage of submitted household profiles or request bodies.
- **Reliability:** the exact evaluated deploy is live, the deep health check passes, and errors are triaged. Any incorrect official handoff, sensitive-data exposure, or reproducible misleading coverage claim pauses the evaluation until fixed and replayed.
- **Evidence reporting:** publish denominators and per-case results. Do not turn a test pass into a claim of improved enrollment, cost savings, network accuracy, or clinical outcome.

## Governance before any UH-sponsored or real-data pilot

The Outside-In sponsor and UH reviewers must choose the intended users and workflow; decide ownership/COI routing; approve architecture, security, accessibility, and privacy/data flow; settle whether the activity is operational evaluation or human-subjects research; and specify any agreements, data access, retention, incident response, support, and hosting requirements. The Marketplace API team's written terms/attribution clarification is also open. No UH deployment, endorsement, records, or patient use is authorized by this document.

## Evidence record

For each run retain the commit and deploy ID, environment, source/plan year, synthetic fixture set, test results, discrepancies, accessibility findings, operator, and date. Redact secrets and avoid real person-level information. The `eval:production-readiness` bundle includes the synthetic preflight but remains a code/regression gate, not a substitute for this live protocol.
