# [affinity.] PRODUCT_DOCTRINE

---

## current system state (snapshot)

- **Stage:** **M0–M5 landed — LIVE at affinity.pwr-labs.ai.** Engines: M0 spine (Prisma `Profile`/`Plan`/`CoverageClaim`, provenance core, Marketplace API + issuer-MRF clients, API↔MRF reconciliation, `GET /api/health`) + **M1 matching** + **M2 true-cost** (PTC + CSR subsidy, OOP + drug costs, rank by true annual cost) + **M3 verification** (graded A–F confidence + freshness + confirm-checklist). **M4 decision UI** = a **web shell** (`src/app/*`, `src/components/*`, `src/lib/decision/*`) on the [PWR] LABS design language (nucleus foundation, green wordmark), **web-only (no desktop)**, deploys to **affinity.pwr-labs.ai** (`render.yaml`); renders the ranked-by-true-cost board on live HealthCare.gov data. Eval bundle green: 56 unit tests + `eval:{m0-smoke,api-mrf-diff,match,cost,verify,live-dryrun,ui-smoke,network-bridge}` (typecheck + build + evals pass).
- **Product:** ACA marketplace plan selection with **network truth** — match a household's doctors + meds to plans, rank by true annual cost, and score how trustworthy each coverage claim is.
- **Bucket:** green healthcare/biotech family. Brand accent green `#2d9c4a`.
- **Honest limits:** the eval bundle runs on deterministic fixtures (no key needed for the gate), while the live app at **affinity.pwr-labs.ai** uses the real Marketplace API. The issuer-MRF cross-check (the second source for the confidence score) and the runtime LLM explainer are not wired into the live app yet; the LLM ships flag-default-off. Marketplace API ToS for commercial use is OPEN (`docs/COMPLIANCE_NOTES.md`). Implement from `docs/AFFINITY_PRODUCT_VISION.md`.

---

## 0. What this document is

Operating manual for **[affinity.]** — a **[PWR] LABS** product lane.

| Role | Holds |
| --- | --- |
| **Doctrine** | Product thesis, principles, scope honesty |
| **Codebook** | Env keys, repo layout, verification |
| **Changelog** | Build log in `CHANGELOG.md` |

Vision spec: [`docs/AFFINITY_PRODUCT_VISION.md`](AFFINITY_PRODUCT_VISION.md). **Portfolio admin:** **[nucleus.]** — no runtime dependency.

---

## 1. Product thesis

**[affinity.]** is the **plan-selection decision tool** for people buying ACA marketplace coverage who
need to know what *actually* covers them — not what an out-of-date directory claims.

- **Primary objects:** `Profile` (household: ZIP, income, doctors by NPI, meds + dosage) ↔ `Plan` (QHP).
- **Core job:** per plan — doctors in-network? meds on formulary + tier? true expected annual cost?
  and a **confidence signal** on those answers — then rank by true cost with a confirm-checklist.
- **Not:** broker funnel, premium-only quoter, chatbot, or insurance/financial advice.

**Buyer (generic):** anyone navigating HealthCare.gov (or a state exchange) who has specific doctors
and prescriptions and cannot afford to guess — especially people coming off Medicaid into a Special
Enrollment Period.

---

## 2. Non-negotiables

- **Network truth** — never present "in-network" / "on-formulary" as fact. Every coverage claim carries
  **source + freshness + confidence**; conflicts are surfaced; the user is always told to confirm with
  the provider's office and the official Marketplace before enrolling.
- **Total cost of care** — rank on expected annual cost (premium − subsidy + deductible/copay/coinsurance
  + drug-tier costs), never sticker premium alone.
- **Neutral** — no commission steering, no broker funnel, no plan kickbacks. The tool serves the user.
- **Decision support, not advice** — not licensed insurance/financial advice; defer the final word to
  the provider and the official Marketplace.
- **Privacy / local-first** — health + income data is the user's; minimize and protect PII; never put
  PII in URLs or query strings.
- **Structure before LLM** — deterministic matching + cost + verification first; the plain-language
  explainer (LLM) ships **flag-default-off**, model-agnostic, validated.
- **Provenance** — every network/formulary datum records its source + fetch time.

---

## 3. Documentation loop

1. `docs/PRODUCT_DOCTRINE.md` — this file (doctrine + non-negotiables)
2. `docs/AFFINITY_PRODUCT_VISION.md` — full vision + roadmap
3. `CHANGELOG.md` — build log / changelog
4. `README.md` — repo map, quickstart, deploy

---

## 4. Where this is going

affinity starts at the hardest moment — losing Medicaid, choosing an ACA plan — but it's built to become the **coverage-truth layer for any plan**, not just the Marketplace. The engine is source-agnostic: every answer carries its source, freshness, and confidence, so a new coverage type is a new data source, not a new product.

- **Medicare** — drug formularies (Part D) and "does this doctor take Medicare," from public CMS data.
- **A verification moat** — corroborate every claim against independent sources (issuer files, and eventually patient-reported experience), so "in-network" is *scored, never asserted*.
- **Medicare Advantage & Medicaid managed care** — as the 2027 federal directory + prior-auth APIs come online.
- **Commercial / employer plans** — the largest and hardest, via the federal Transparency-in-Coverage files.

Same promise the whole way: source + freshness + confidence on every claim, ranked on true annual cost, neutral, honest about what to confirm.

---

## 5. Changelog

Canonical build log: [`CHANGELOG.md`](../CHANGELOG.md).
