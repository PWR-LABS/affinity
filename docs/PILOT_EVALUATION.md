# [affinity.] Outside-In evaluation protocol

Status: proposed, non-confidential. This document is a reproducible evaluation plan, not a UH pilot authorization or evidence of clinical benefit.

## First use case

Evaluate whether an adult who may be leaving Medicaid can identify the correct official next step and interpret a federal Marketplace plan comparison without mistaking source-reported coverage or annualized premium for a guarantee. Keep the initial test to synthetic, one-person 2026 profiles. Do not enter UH or patient records.

## What is available for evaluation

- Public Medicaid application and renewal routes for all 50 states and D.C.
- Federal Marketplace screening and plan comparison in supported states, with net monthly and annual premium, deductible, out-of-pocket maximum, and Marketplace-reported provider and drug matches.
- Source labels, uncertainty language, and an instruction to confirm coverage with the insurer and provider before enrollment.
- A public privacy and data-flow explanation. No accounts or saved household profiles.

The public ACA board has one coverage source. The tested issuer-file reconciliation, A-F grade, and fuller annual care-cost engine are **not** live consumer features. Employer and Part D verification require their indexes to be loaded and are outside this first evaluation.

## Synthetic evaluation sequence

1. Freeze the deployed Git commit, plan year, official source URLs, test date, and expected outputs. Use synthetic profiles only.
2. Exercise every state and D.C. handoff link, plus at least 30 prewritten profiles spanning Medicaid-likely, Marketplace-subsidy-likely, no-subsidy, state-based Marketplace, ZIP ambiguity, multi-person handoff, missing data, and upstream failure. Compare routing and source figures with the official service on the same day.
3. For supported Marketplace profiles, record each displayed plan's source identifier, quote year, monthly and annual net premium, deductible, out-of-pocket maximum, and selected provider/drug statuses. Treat missing source fields as unknown. Recalculate annual premium as 12 times the displayed monthly figure; do not call it total annual cost.
4. Have a small group of intended non-patient reviewers attempt the journey. Ask them to identify the official next step, explain what a source-reported match means, and name what they would confirm before enrollment. Record task completion and misunderstandings, not just satisfaction.
5. Repeat a subset on desktop, mobile, keyboard-only, and screen reader. Track defects against WCAG 2.2 AA as an accessibility target; do not claim conformance from an automated scanner alone.
6. Review the error and privacy logs for the evaluation window, then document every discrepancy with a reproduction and disposition.

## Proposed acceptance and stop rules

- **Route safety:** every tested state handoff points to the intended official service; no synthetic unsupported-state or multi-person case receives a fabricated federal estimate.
- **Claim safety:** zero displayed guarantees of provider participation, formulary coverage, eligibility, or full annual care cost. Unknown data remain visibly unknown.
- **Privacy:** no participant or patient data; no health/income/search terms in [affinity.] request URLs; no intentional storage of submitted household profiles or request bodies.
- **Reliability:** the exact evaluated deploy is live, the deep health check passes, and errors are triaged. Any incorrect official handoff, sensitive-data exposure, or reproducible misleading coverage claim pauses the evaluation until fixed and replayed.
- **Evidence reporting:** publish denominators and per-case results. Do not turn a test pass into a claim of improved enrollment, cost savings, network accuracy, or clinical outcome.

## Governance before any UH-sponsored or real-data pilot

The Outside-In sponsor and UH reviewers must choose the intended users and workflow; decide ownership/COI routing; approve architecture, security, accessibility, and privacy/data flow; settle whether the activity is operational evaluation or human-subjects research; and specify any agreements, data access, retention, incident response, support, and hosting requirements. The Marketplace API team's written terms/attribution clarification is also open. No UH deployment, endorsement, records, or patient use is authorized by this document.

## Evidence record

For each run retain the commit and deploy ID, environment, source/plan year, synthetic fixture set, test results, discrepancies, accessibility findings, operator, and date. Redact secrets and avoid real person-level information. The `eval:production-readiness` bundle is a code/regression gate, not a substitute for this live protocol.
