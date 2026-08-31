# [affinity.] — product vision

**[PWR] LABS** product lane. Green healthcare/biotech bucket.
Status: **vision drafted (2026-06-17)** — M0 build lane next. Founder-authored; honest limits visible.

---

## 1. One-liner

*"Don't trust 'in-network' — verify it."* [affinity.] tells you which ACA marketplace plan actually
covers **your** doctors and **your** medications, what it will **really** cost you for the year, and
**how much to trust** the network/formulary data behind that answer.

## 2. Why this exists (the wedge)

The official tools represent provider networks and drug coverage as static, authoritative facts. They
are not:

- **Ghost networks** — provider directories run **30–40% inaccurate** (retired/moved/not-accepting);
  mental health worst (~55% unavailable). Actively litigated (APA v. EmblemHealth Jan 2026;
  Carelon/Elevance class action).
- **The issuer data itself is broken** — a Dec 2025 medRxiv analysis found **~59,899 import errors
  across 735 issuer machine-readable-file logs**.
- **Affordability pressure** — enhanced premium tax credits expired Jan 1, 2026; net premiums rose
  ~114% on average — so picking the *truly* cheapest-for-you plan matters more than ever.

If you trust "in-network" blindly, you can be **locked into a plan you cannot use**. That lived
failure (the operator hit it during their own post-Medicaid enrollment) is the product.

**Gap in the market:** no neutral, consumer-grade, **ACA** tool that does *total cost of care +
network truth*. Healthpilot does doctor/drug matching but is **Medicare**; HealthSherpa/eHealth are
**broker funnels** (commission-driven); HealthCare.gov is the broken baseline; KFF is money-only.

## 3. Primary object & core job

- **Primary objects:** `Profile` (a household: ZIP, income/household size, **your doctors** by NPI,
  **your meds** + dosage) matched against `Plan` (an ACA QHP for that rating area).
- **Core job:** for each plan, answer — *are my doctors in-network? are my meds on formulary and at
  what tier? what is my expected annual total cost? and how much should I trust those answers?* —
  then rank plans by true cost with a network-confidence signal and a "what to double-check" list.
- **Not:** a broker funnel, a generic premium quoter, a chatbot, or insurance/financial advice.

## 4. Data sources

| Source | Role |
| --- | --- |
| **Marketplace API** (`developer.cms.gov/marketplace-api`) | Plan search, doctor/facility/drug coverage, OOP utilization, Medicaid/CHIP eligibility estimate. Free key; rotation is notice-driven (the October 26, 2026 rotation is postponed to a date TBD in 2027). |
| **QHP Provider & Formulary MRFs** (`CMSgov/QHP-provider-formulary-APIs`) | Raw `providers.json` / `drugs.json` / `plans.json` per issuer (the second source to diff the API against). |
| **KFF subsidy calculator** | Validation oracle for the subsidy/CSR math. |

## 5. The moat: the network-truth layer

Everyone can fetch the data; nobody makes it *trustworthy*. [affinity.] reconciles the Marketplace
API against the issuer MRFs, scores **freshness** (last-updated) and **agreement** (do the two
sources concur?), flags conflicts ("API says in-network, issuer file says out"), and emits a per-plan
**network-confidence score** plus a concrete *"call these offices to confirm"* checklist. Later:
crowd-verification ("did your doctor actually take this plan?") and secret-shopper checks build a
freshness-scored network graph better than any single issuer's file.

## 6. Milestone roadmap (eval-first)

| Milestone | Deliverable | Gate |
| --- | --- | --- |
| **M0** | Marketplace API client + `Profile`/`Plan` spine + health route; **pull one issuer MRF and diff it vs the API** (feasibility check **and** moat demo) | typecheck + smoke + `eval:api-mrf-diff` |
| **M1** | Network + formulary **matching** — per plan, your doctors' in-network status + your meds' formulary tier | `eval:match` |
| **M2** | **True-cost engine** — premium − subsidy (PTC + CSR on Silver by FPL) + expected deductible/copay/coinsurance + drug-tier costs; validate vs KFF | `eval:cost` |
| **M3** | **Network-truth / verification** — API↔MRF reconciliation, freshness + confidence score, conflict flags, confirm-checklist | `eval:verify` |
| **M4** | **Decision UI (web shell)** — ranked plans by true cost with confidence flags + confirm checklist; profile intake follows. **Web only** (no desktop build) on the [PWR] LABS design language (nucleus `design-system/pwr-labs-desktop.css` foundation, green period-accent wordmark); deploys to **affinity.pwr-labs.ai** | UI smoke |
| **M5** | **Personal MVP complete** (one real post-Medicaid enrollment, end to end) → then product breadth (all states, saved profiles, SEP guidance, reminders), crowd-verification, flagged LLM explainer | per-feature evals |

## 7. Phase boundary: personal MVP → product

Phase-1 MVP = solve one real post-Medicaid enrollment end to end (a hard, real deadline), one state.
It is the proof of the cost + verification pipeline on live data.
Phase-2 = generalize to a commercial product (the operator builds full products that happen to serve
a personal need first).

## 8. Risks / open questions

- Data accuracy is the moat **and** the hardest problem; crowd/secret-shopper verification is
  labor-intensive at scale.
- **Marketplace API Terms of Service / commercial-use licensing** — confirm before commercial launch.
- Seasonality (Nov–Jan demand spike); SEPs year-round but a smaller pool; subsidized market shrinking
  post-credit-expiry, but pain-per-user is higher.
- Recommendation liability → stay decision-support ("verify with provider"), never advice.

## 9. Honest limits (today)

No application code yet. No Marketplace API key requested yet. This doc + the doctrine stack are the
bootstrap; M0 implements from here.
