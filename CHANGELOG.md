# [affinity.] — build log / changelog

Public, chronological record of what shipped. The durable doctrine lives in
[`docs/PRODUCT_DOCTRINE.md`](docs/PRODUCT_DOCTRINE.md). No personal data appears here — live runs are described against a **demo profile** whose ZIP /
income / providers / medications are set locally in `.env` and never committed.

---

## Foundations (2026-06-17)

- **M0 — spine.** Next.js + Prisma (`Profile` / `Plan` / `CoverageClaim`), the provenance core (every
  coverage answer carries source + freshness + confidence), the Marketplace API and issuer machine-readable-file
  clients, and the API↔MRF reconciliation "moat," behind an eval bundle.
- **M1 — matching.** Per-plan doctor/medication coverage status → plan-level network-confidence + a
  "call to confirm" checklist + coverage ranking (`eval:match`).
- **M2 — true-cost engine.** PTC + CSR subsidy math, expected out-of-pocket + drug-tier costs, ranked by
  **true annual cost** rather than sticker premium (`eval:cost`).
- **M3 — verification surface.** Graded A–F network-confidence, freshness summary, actionable
  confirm-checklist (`eval:verify`).
- **Hardening.** Unit suite, MRF-parser robustness, live-wiring dry-run, compliance notes + README quickstart.
- **M4 — decision UI.** A **web shell** (no desktop) on the [PWR] LABS design language: the ranked-by-true-cost
  board with confidence grades + confirm checklists. `render.yaml` → affinity.pwr-labs.ai.

## Network-bridge check

- In two-system metros, narrow plans usually contract with ONE health system. `analyzeBridges` groups a
  plan's reconciled providers by system, grades per-system coverage (never a bare "in-network"), flags a
  **critical gap** when a must-keep provider goes out-of-network, and ranks bridge-plans first — then, among
  single-system plans, the one that keeps the critical provider. Deterministic; gated by `eval:network-bridge`
  over a synthetic fixture.

## Going live (2026-06-30)

- **Live PoC against the real Marketplace API** (demo profile): confirmed the eligibility verdict, and that
  real plans can bridge two competing health systems in one metro. Corrected the live coverage model — plan
  search does **not** inline coverage; added dedicated `/providers/covered` + `/drugs/covered` calls (plan-id
  batches chunked; page size fixed at 10).
- **ToS cleared** — the Marketplace API is built for live consumer front-ends; free public use is its purpose
  (rate-limited, no bulk scraping, both compatible with per-request use).
- **Live eligibility check** — the highest-value, simplest output (ZIP + income + household, no doctors/meds):
  Medicaid vs. subsidized-Marketplace vs. coverage-gap verdict, server-side, key never reaching the client,
  no PII logged.
- **Live plan board + autocomplete pickers** (`/plans`) — accessible typeahead for doctors (name→NPI near ZIP,
  via the Marketplace) and medications (name→formulary-correct product, via NLM RxTerms), then a ranked board
  of real plans: net premium after subsidy, deductible/OOP, and which plans keep the user's doctors in-network
  and cover their meds.
- **LIVE at affinity.pwr-labs.ai** 🎉 — deployed on Render (auto-deploy on `main`), custom domain + valid TLS,
  live HealthCare.gov data flowing. Stateless, free, no PII stored.
- **Direction:** "we're all patients" — build toward a universal verify-any-provider-on-any-plan tool; the big
  next lift is the commercial/Medicare data layer (Transparency-in-Coverage + Medicare bulk files).

## QA / hardening on the live tool (2026-06-30)

- Cost-share audit cleared (the API returns the income-appropriate CSR variant); refined the picker to prefer
  the per-person Individual figure.
- Honest empty-state on `/plans`; a clear 400 for a non-existent ZIP instead of a misleading "try again";
  household-size validation; catastrophic plans no longer show a wrongly-subsidized premium.
- Typeahead shows a "No matches" state instead of silent nothing.
- **State-Based Marketplaces** — the federal API only serves ~30 states. The other ~20 + DC (Covered
  California, NY State of Health, Pennie, …) now get an honest redirect to their own exchange instead of a
  broken retry loop.

## Launch polish, accessibility & brand (2026-06-30)

- Branded 404 + error boundaries, real favicon, generated OpenGraph share card, full social/SEO metadata,
  `robots` + `sitemap`.
- **WCAG AA** — computed-contrast sweep across every page; deepened the accent to clear 4.5:1; app-wide
  `prefers-reduced-motion` guard; verified structure (one h1/page, labeled inputs, no positive tabindex).
- **Brand** — the [PWR] LABS family bracket-dot mark as favicon + iOS icon, and the bracketed `[affinity.]`
  wordmark in the header, share card, and page title.

## Commercial pilot — the TiC network-truth layer (2026-07-02)

- **Ingest toolchain** (`tools/tic-ingest/`, built by Codex to spec, independently verified): streaming
  table-of-contents manifest, constant-memory in-network extractor (v2 inline + v1 reference fallback,
  rates discarded entirely), NPPES metro allowlist. Real pilot: Medical Mutual of Ohio — 61 files, 5 GB
  gz → **630K provider↔plan memberships** extracted and loaded.
- **S4 — thin index.** `ISSUER_TIC_MRF` source tag; `TicFile`/`TicMembership`/`TicPlanLink` (membership
  joins through the file — no npi×plan explosion, no rates stored); idempotent `tic:load`; first Prisma
  migration applied to a real Postgres.
- **S5 — N-way reconciliation.** `reconcileMany()`: agreement across k independent sources compounds
  toward a hard 0.95 cap; any conflict collapses confidence, stays consensus-unknown (a majority never
  silently wins), and is stamped onto every answer. The M0 two-way form is now a view over the same
  core. TiC adapter emits doctrine-shaped answers (listed→yes · indexed-but-absent→no · unindexed→honest
  unknown). New `eval:tic-reconcile`; readiness bundle now 10 gates.
- **S6 — `/verify` (beta).** Verify a doctor on an employer plan: plan-name search over the indexed
  links + direct EIN entry (W-2 box b), doctrine-rendered result with source, freshness, and a visible
  confidence meter. Honest limits on-page: one source, doctors-only for commercial, confirm before
  relying. Off the main nav until the index is provisioned in production.

## Medicare Part D — the formulary + restriction-detail layer (2026-07-05)

- **S7 — Part D ingest** (`tools/tic-ingest/partd-formulary`, Codex to spec, verified): the monthly CMS
  Part D PUF (a zip-of-zips) → formulary + plan NDJSON, constant-memory. Real June 2026 file →
  **1,124,586 formulary rows · 5,518 plans across all 50 states** — genuinely nationwide (CMS publishes
  one national file), loaded into local + production Postgres.
- **`CMS_PARTD` source + adapter.** New source tag (base confidence 0.65) flowing through the same N-way
  `reconcileMany()` core; `buildPartDAnswer` emits doctrine answers (on-formulary→yes w/ tier ·
  indexed-but-absent→no · unindexed→honest unknown). New `eval:partd-reconcile`; readiness bundle now 11 gates.
- **Restriction detail from the CMS source.** The adapter surfaces the **prior-authorization /
  step-therapy / quantity-limit** utilization-management fields published in the CMS Part D PUF. A live
  check found AARP Medicare Rx Preferred, RxCUI 1000048, on formulary at tier 4 **with PA required**.
  Correction (2026-08-05): the earlier wording said official consumer tools hide these fields. Medicare
  Plan Finder has long displayed drug restrictions; the HealthCare.gov developer API is an ACA product
  and is not the Medicare comparator. See `docs/PARTD_DISCLOSURE_AUDIT.md`.
- **`/api/partd/verify`.** POST (drug/plan never land in URLs), doctrine-shaped result plus the UM flags,
  503-degrades when the index isn't provisioned. Medicare is now queryable end-to-end.
- **Medication-first Part D shortlist (2026-08-05).** A user can enter a state and up to 20 exact drug
  products, then compare the loaded statewide standalone Part D formularies without knowing a plan name.
  Results rank medications listed first, then reported restriction burden and average tier. Medicare
  Advantage is deliberately excluded from discovery because availability is county-specific; the exact-plan
  checker remains available for a plan the user already knows. This is a formulary-fit shortlist, not a
  premium or pharmacy-price ranking.
- **PDP geography repair.** The CMS plan file uses `PDP_REGION_CODE` for standalone plans rather than the
  `STATE` field used by local Medicare Advantage plans. The ingest alias, Prisma model, loader, and an
  idempotent plan-only backfill now retain that region code; the app maps a state to CMS's published PDP
  region before comparing plans. The fix updates 367 standalone plan records without reloading the 1.1
  million-row formulary table.

## Nationwide groundwork (2026-07-05)

- **Issuer registry** (`tools/tic-ingest/issuer-registry`, SPEC-8, Codex to spec): a curated top-~35
  commercial-issuer seed + a streaming validator that confirms each Transparency-in-Coverage index is a
  live TiC table-of-contents and records in-network file counts + schema (v1 references / v2 inline) —
  the evidence table that sizes a national build before any multi-TB download. Unresolved issuers are
  honest recorded gaps, never dropped. SPEC-9 (resolve the live index URLs) queued next.

## Sizing the national build (2026-07-09)

- **SPEC-9, live index URLs resolved.** The issuer registry stops being a list of names and becomes real
  evidence: each Transparency-in-Coverage index is fetched and confirmed to be a live table of contents,
  with in-network file counts and schema (v1 references / v2 inline) recorded. Unresolved issuers stay
  honest recorded gaps rather than quietly disappearing.
- **SPEC-10, parse-throughput benchmark** (`tools/tic-ingest`, Codex to spec). Bounded measurement, not
  the build: stream-parse the giant shared-network files (UHC 8.9 GB, Cigna 1.5 GB gz) and measure MB/s,
  membership yield, and the employer-to-shared-file dedup ratio, turning the rough monthly infrastructure
  estimate into measured numbers for a go/no-go. The fan-out ingest pipeline remains a later, gated spec.

## Interface refinement (2026-07-15)

- Light-interface pass across the app surfaces.

## Nationwide Medicaid navigation (2026-08-21)

- **All 50 states + D.C.** The coverage check now asks for state explicitly and attaches the official state
  Medicaid application or renewal entry point, member phone number, and CMS eligibility-change guide. State-based
  marketplaces fail safely into their own official service rather than receiving a federal-data guess.
- **`/medicaid` change desk.** A nationwide state selector explains the federal work and community-engagement
  requirements scheduled for January 1, 2027, common exclusions, and immediate keep-coverage steps.
- **New York + Ohio state watch.** Source-backed cards distinguish enacted/current renewal changes from the
  January 2027 federal requirement: New York's discontinued continuous-eligibility authorities and Ohio's
  six-month expansion-group review law. The copy stays decision support; only the state makes a determination.

## Marketplace API key rotation update (2026-08-31)

- CMS postponed the planned October 26, 2026 Marketplace API key rotation until after Open Enrollment. The new
  rotation date is TBD in 2027. Operator docs and configuration comments were updated without storing any key
  value or identifier.
