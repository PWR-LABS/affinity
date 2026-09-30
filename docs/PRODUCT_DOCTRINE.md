# [affinity.] PRODUCT_DOCTRINE

---

## current system state (snapshot)

- **Stage: live at affinity.pwr-labs.ai; runtime capability is narrower than the tested engine.**
  - **ACA Marketplace (live).** The public board uses real HealthCare.gov Marketplace data to show source-reported doctor and medication matches, estimated net monthly premium, twelve months of that displayed premium, deductible, and in-network out-of-pocket maximum. It first prioritizes plans listing all selected doctors, then more listed medications, then lower quoted net premium. Annual net premium is **not** a full annual care-cost estimate. A missing source premium stays unknown. The issuer-MRF second witness, true annual-cost engine, and A–F verification grades exist in tested code but are **not wired into the live ACA board**.
  - **Nationwide Medicaid navigation (all 50 states + D.C.).** The home check now asks for state explicitly, safely hands state-based-marketplace users to their own official service instead of guessing from federal-only data, and attaches each state's official application or renewal entry point and member phone. `/medicaid` distinguishes six-month renewals for most adults in the expansion group from the separate community-engagement requirement for certain adults, with source-backed New York and Ohio watches. Both federal changes are scheduled for 2027; individual state notices govern next steps. This is navigation and screening, not a state eligibility determination, renewal submission service, coverage-disruption tracker, or Medicaid managed-care network verifier.
  - **Commercial / Transparency in Coverage (pilot and source-gated beta).** Thin index (`TicFile`/`TicMembership`/`TicPlanLink`, memberships join through the file so there is no npi×plan explosion and no rates stored), N-way reconciliation, and `/verify` for checking a doctor on an employer plan **when the complete source index is loaded**. Pilot: Medical Mutual of Ohio, 61 files, 5 GB gz, 630K provider-to-plan memberships; these pilot counts are not a claim of national runtime coverage.
  - **Medicare Part D (indexed capability, source-gated at runtime).** The CMS PUF ingest produced 1,124,586 formulary rows across 5,518 plans in all 50 states. When the index is loaded, the medication-first shortlist compares statewide standalone Part D formularies by listed medications, reported restrictions, and tier; the exact-plan checker also supports Medicare Advantage plans when the user supplies one. Both surfaces show the PUF's prior-authorization, step-therapy, and quantity-limit fields. The historical ingest counts do not prove a current production index is loaded.
  - **Nationwide groundwork (SPEC-8 through SPEC-10).** A curated commercial-issuer registry with a streaming validator, live TiC index URLs resolved into real evidence, and a parse-throughput benchmark that turns the go-national cost estimate into measured numbers. Fan-out ingest remains a later, gated spec.
- **Reconciliation is N-way.** `reconcileMany()` is the core: agreement across k independent sources compounds toward a hard 0.95 cap, any conflict collapses confidence and stays consensus-unknown (a majority never silently wins), and the verdict is stamped onto every answer. The original two-source form is now a view over the same core.
- **Product direction:** plan selection with **network truth**. The live board reports what the Marketplace says and prompts confirmation; independent corroboration, full annual-cost ranking, and graded coverage confidence are tested engine capabilities, not current live ACA claims.
- **Bucket:** green healthcare/biotech family. Brand accent green `#2d9c4a`.
- **Eval bundle green:** 11 gates (`eval:{m0-smoke,api-mrf-diff,match,cost,verify,live-dryrun,ui-smoke,network-bridge,tic-reconcile,partd-reconcile}` under `eval:production-readiness`), with typecheck and build passing. The bundle runs on deterministic fixtures and needs no API key.
- **Honest limits:** the live ACA app has only Marketplace API coverage evidence, no issuer-file corroboration, no full annual care-cost estimate, and no A–F confidence grade. The runtime LLM explainer remains flag-default-off. Medicaid navigation does not encode every state's eligibility categories or replace an official application. The Verify surface is visible but each tool fails closed until its complete source index is loaded. Commercial coverage is doctors-only. The Part D shortlist excludes Medicare Advantage because county service areas are not preserved in the current index, and it ranks formulary fit rather than premium or pharmacy-specific price. Marketplace API ToS for commercial use is OPEN (`docs/COMPLIANCE_NOTES.md`). Implement from `docs/AFFINITY_PRODUCT_VISION.md`.

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

**[affinity.]** is a **plan-selection decision tool** for people who need to question what a directory
claims, not assume a source-reported match guarantees coverage.

- **Primary objects:** `Profile` (household: ZIP, income, doctors by NPI, meds + dosage) and `Plan` (QHP).
- **Core job:** compare source-reported doctor and medication coverage and plan costs with explicit
  uncertainty. The target architecture adds independent corroboration, a full expected annual-cost
  estimate, and per-claim confidence; the live ACA board does not yet provide those three features.
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
- **Total cost of care is the target, not a present-tense runtime claim.** The live board shows net
  monthly and annualized premium alongside deductible and out-of-pocket maximum, and says clearly that
  annual premium excludes care spending. The tested cost engine is not yet the live ranking key.
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

The repository has source adapters for ACA Marketplace, Medicare Part D, and commercial plans via
Transparency in Coverage. Their live availability and evidence depth differ: the ACA board uses one
Marketplace source, while Part D and commercial verification require their complete indexes to be loaded.
What remains is both runtime integration and reach.

- **Medicare beyond Part D.** "Does this doctor take Medicare," and Medicare Advantage as the 2027 federal
  directory and prior-authorization APIs come online.
- **The verification moat, widened.** Corroborate every claim against more independent sources, including
  eventually patient-reported experience, so "in-network" stays *scored, never asserted*.
- **Medicaid managed care**, on the same directory rails.
- **Commercial and employer plans at national scale.** The largest and hardest lane. The registry, resolved
  index URLs, and throughput benchmark exist to size that build honestly before committing to it.

Same target the whole way: source, freshness, and confidence on every claim, ranked on a defensible full
annual cost when the inputs support it. Until then, label narrower estimates and confirmation steps honestly.

---

## 5. Changelog

Canonical build log: [`CHANGELOG.md`](../CHANGELOG.md).
