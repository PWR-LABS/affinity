# [affinity.] PRODUCT_DOCTRINE

---

## current system state (snapshot)

- **Stage: live at affinity.pwr-labs.ai, now across three coverage lanes.**
  - **ACA Marketplace (M0 through M5, live).** M0 spine (Prisma `Profile`/`Plan`/`CoverageClaim`, provenance core, Marketplace API + issuer-MRF clients, reconciliation, `GET /api/health`), M1 matching, M2 true-cost (PTC + CSR subsidy, OOP + drug costs, rank by true annual cost), M3 verification (graded A through F confidence + freshness + confirm-checklist), M4 decision UI as a web shell on the [PWR] LABS design language (web-only, no desktop), M5 live on real HealthCare.gov data via `render.yaml`.
  - **Commercial / Transparency in Coverage (S4 through S6).** Thin index (`TicFile`/`TicMembership`/`TicPlanLink`, memberships join through the file so there is no npi×plan explosion and no rates stored), N-way reconciliation, and `/verify` (beta) for verifying a doctor on an employer plan. Pilot: Medical Mutual of Ohio, 61 files, 5 GB gz, 630K provider-to-plan memberships.
  - **Medicare Part D (S7).** Monthly CMS PUF to formulary + plan NDJSON at constant memory: 1,124,586 formulary rows across 5,518 plans in all 50 states. `POST /api/partd/verify` is queryable end to end and surfaces the PUF's prior-authorization, step-therapy, and quantity-limit fields in the same compact result as formulary status and tier.
  - **Nationwide groundwork (SPEC-8 through SPEC-10).** A curated commercial-issuer registry with a streaming validator, live TiC index URLs resolved into real evidence, and a parse-throughput benchmark that turns the go-national cost estimate into measured numbers. Fan-out ingest remains a later, gated spec.
- **Reconciliation is N-way.** `reconcileMany()` is the core: agreement across k independent sources compounds toward a hard 0.95 cap, any conflict collapses confidence and stays consensus-unknown (a majority never silently wins), and the verdict is stamped onto every answer. The original two-source form is now a view over the same core.
- **Product:** plan selection with **network truth**. Match a household's doctors and medications to plans, rank by true annual cost, and score how trustworthy each coverage claim is.
- **Bucket:** green healthcare/biotech family. Brand accent green `#2d9c4a`.
- **Eval bundle green:** 11 gates (`eval:{m0-smoke,api-mrf-diff,match,cost,verify,live-dryrun,ui-smoke,network-bridge,tic-reconcile,partd-reconcile}` under `eval:production-readiness`), with typecheck and build passing. The bundle runs on deterministic fixtures and needs no API key.
- **Honest limits:** the live ACA app uses the real Marketplace API, but the issuer-MRF cross-check (the second witness behind the ACA confidence score) and the runtime LLM explainer are not wired into it yet; the LLM ships flag-default-off. The Verify surface is visible but each tool fails closed until its complete source index is loaded. Commercial coverage is doctors-only, and Part D is formulary verification rather than full Medicare plan comparison. Marketplace API ToS for commercial use is OPEN (`docs/COMPLIANCE_NOTES.md`). Implement from `docs/AFFINITY_PRODUCT_VISION.md`.

---

## 0. What this document is

Operating manual for **[affinity.]**, a **[PWR] LABS** product lane.

| Role | Holds |
| --- | --- |
| **Doctrine** | Product thesis, principles, scope honesty |
| **Codebook** | Env keys, repo layout, verification |
| **Changelog** | Build log in `CHANGELOG.md` |

Vision spec: [`docs/AFFINITY_PRODUCT_VISION.md`](AFFINITY_PRODUCT_VISION.md). **Portfolio admin:** **[nucleus.]**, with no runtime dependency.

---

## 1. Product thesis

**[affinity.]** is the **plan-selection decision tool** for people who need to know what *actually*
covers them, not what an out-of-date directory claims.

- **Primary objects:** `Profile` (household: ZIP, income, doctors by NPI, meds + dosage) and `Plan` (QHP).
- **Core job:** per plan, are the doctors in-network? Are the medications on formulary, and at what tier?
  What is the true expected annual cost? Plus a **confidence signal** on those answers, then rank by true
  cost with a confirm-checklist.
- **Not:** a broker funnel, a premium-only quoter, a chatbot, or insurance and financial advice.

**Buyer (generic):** anyone navigating HealthCare.gov or a state exchange who has specific doctors and
prescriptions and cannot afford to guess, especially people coming off Medicaid into a Special Enrollment
Period. The same engine now answers Medicare Part D and employer-plan questions, because the answer shape
is source-agnostic.

---

## 2. Non-negotiables

- **Network truth.** Never present "in-network" or "on-formulary" as fact. Every coverage claim carries
  **source, freshness, and confidence**; conflicts are surfaced; the user is always told to confirm with
  the provider's office and the official Marketplace before enrolling.
- **Total cost of care.** Rank on expected annual cost (premium minus subsidy, plus deductible, copay,
  coinsurance, and drug-tier costs), never sticker premium alone.
- **Neutral.** No commission steering, no broker funnel, no plan kickbacks. The tool serves the user.
- **Decision support, not advice.** Not licensed insurance or financial advice; defer the final word to
  the provider and the official Marketplace.
- **Privacy and local-first.** Health and income data is the user's; minimize and protect PII; never put
  PII in URLs or query strings. Verify routes are POST for exactly this reason.
- **Structure before LLM.** Deterministic matching, cost, and verification first; the plain-language
  explainer ships **flag-default-off**, model-agnostic, and validated.
- **Provenance.** Every network and formulary datum records its source and fetch time.
- **A majority never silently wins.** When independent sources conflict, the answer stays consensus-unknown
  and the confidence collapses. Adding sources must not become a way to outvote a disagreement.

---

## 3. Documentation loop

1. `docs/PRODUCT_DOCTRINE.md`, this file (doctrine + non-negotiables)
2. `docs/AFFINITY_PRODUCT_VISION.md`, full vision + roadmap
3. `CHANGELOG.md`, build log / changelog
4. `README.md`, repo map, quickstart, deploy

---

## 4. Where this is going

affinity starts at the hardest moment, losing Medicaid and choosing an ACA plan, but it is built to become
the **coverage-truth layer for any plan**. The engine is source-agnostic: every answer carries its source,
freshness, and confidence, so a new coverage type is a new data source rather than a new product.

That claim is no longer only forward-looking. Three lanes now answer in the same doctrine shape:
ACA Marketplace, Medicare Part D, and commercial plans via Transparency in Coverage. What remains is depth
and reach.

- **Medicare beyond Part D.** "Does this doctor take Medicare," and Medicare Advantage as the 2027 federal
  directory and prior-authorization APIs come online.
- **The verification moat, widened.** Corroborate every claim against more independent sources, including
  eventually patient-reported experience, so "in-network" stays *scored, never asserted*.
- **Medicaid managed care**, on the same directory rails.
- **Commercial and employer plans at national scale.** The largest and hardest lane. The registry, resolved
  index URLs, and throughput benchmark exist to size that build honestly before committing to it.

Same promise the whole way: source, freshness, and confidence on every claim, ranked on true annual cost,
neutral, and honest about what to confirm.

---

## 5. Changelog

Canonical build log: [`CHANGELOG.md`](../CHANGELOG.md).
