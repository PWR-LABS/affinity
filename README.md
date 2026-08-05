# [affinity.]

**PWR LABS product lane** — ACA marketplace plan selection with **network truth**: find the plan that actually covers *your* doctors and *your* medications, at its *true* annual cost — and how much to trust the network data behind that answer.

**Vision:** [`docs/AFFINITY_PRODUCT_VISION.md`](docs/AFFINITY_PRODUCT_VISION.md) · **Doctrine:** [`docs/PRODUCT_DOCTRINE.md`](docs/PRODUCT_DOCTRINE.md) · **Changelog:** [`CHANGELOG.md`](CHANGELOG.md)
**Claude Code entry:** [`CLAUDE.md`](CLAUDE.md)

**Bucket:** green healthcare/biotech family. Brand accent green `#2d9c4a`.

## The wedge

HealthCare.gov shows provider networks and formularies that are **documented to be 30–40% wrong** ("ghost networks" — litigated; a Dec 2025 medRxiv analysis found ~59,899 import errors across issuer machine-readable files). If you trust "in-network" blindly, you can get **locked into a plan you can't actually use**. [affinity.] reconciles the official Marketplace data against the raw issuer files, scores how fresh/trustworthy each claim is, and tells you what to confirm before you enroll.

## Repo map

| Path | Role |
| --- | --- |
| `src/lib/provenance.ts` | The doctrine in code — every coverage answer carries source + freshness + confidence |
| `src/lib/marketplace/` · `src/lib/mrf/` | Marketplace API client · issuer machine-readable-file layer |
| `src/lib/reconcile.ts` | API↔MRF reconciliation — the network-truth moat |
| `src/lib/matching/` | M1 — per-plan doctor in-network + drug formulary matching, ranked by coverage |
| `src/lib/cost/` | M2 — subsidy (PTC + CSR) + expected OOP + drug costs → rank by **true annual cost** |
| `src/lib/verify/` | M3 — graded network-confidence + freshness + the "what to confirm" checklist |
| `src/lib/decision/` · `src/app/` · `src/components/` | M4 — web shell: ranked-by-true-cost decision board ([PWR] LABS design language; `src/app/pwr-labs.css` foundation) |
| `render.yaml` | Render web-service blueprint → **affinity.pwr-labs.ai** (web only, no desktop) |
| `prisma/schema.prisma` | `Profile` / `Plan` / `CoverageClaim` spine |
| `scripts/eval-*.ts` | Headless eval gates (`eval:m0-smoke`, `eval:api-mrf-diff`, `eval:production-readiness`) |
| [`docs/AFFINITY_PRODUCT_VISION.md`](docs/AFFINITY_PRODUCT_VISION.md) | Product vision + M0–M5 roadmap |
| [`docs/PRODUCT_DOCTRINE.md`](docs/PRODUCT_DOCTRINE.md) | Operating manual + non-negotiables |
| [`CHANGELOG.md`](CHANGELOG.md) | Build log / changelog |
| [`docs/COMPLIANCE_NOTES.md`](docs/COMPLIANCE_NOTES.md) | Legal / regulatory / data notes |

## Quickstart (app)

```bash
cd affinity
npm install                        # installs deps + generates the Prisma client
cp .env.example .env               # optional for the engines; see ".env walkthrough" below
npm run typecheck                  # tsc --noEmit
npm run eval:production-readiness  # the gate: unit suite + eval gates, green out of the box
npm run dev                        # local app → http://localhost:3000  (health: /api/health)
```

The engines (matching, true-cost, verification) run against **deterministic fixtures** with no API key,
so the full gate is green on a fresh clone. A local Postgres is optional — the health route and evals
degrade gracefully without `DATABASE_URL`:

```bash
npm run db:up            # docker compose: Postgres 16 on :5432
npm run db:migrate:dev   # apply the Profile/Plan/CoverageClaim schema
```

Run an individual milestone gate: `npm run eval:api-mrf-diff` (the moat) · `eval:match` (M1) ·
`eval:cost` (M2) · `eval:verify` (M3) · `eval:live-dryrun` (live wiring, mocked) · `npm test` (unit suite).

### .env walkthrough → going live

Everything above works on fixtures. To run the **moat + matching + cost against your real rating area**,
set these in `.env` (all documented inline in [`.env.example`](.env.example)):

| Variable | What it unlocks |
| --- | --- |
| `MARKETPLACE_API_KEY` | Live plan/provider/drug/eligibility data (free key, `developer.cms.gov/marketplace-api`, 60-day rotation). Flips the moat + match evals from fixture to **LIVE**. |
| `AFFINITY_EVAL_ZIP`, `AFFINITY_EVAL_NPIS`, `AFFINITY_EVAL_RXCUIS` | Your ZIP + your doctors' NPIs + your meds' RxCUIs — the household to match. |
| `AFFINITY_EVAL_MRF_PROVIDERS_URL`, `AFFINITY_EVAL_MRF_DRUGS_URL` | One issuer's `providers.json` / `drugs.json` — the second source the API is diffed against. |
| `AFFINITY_EVAL_INCOME`, `AFFINITY_EVAL_AGES` | Household income + ages for the subsidy/true-cost estimate. |

Then `npm run eval:api-mrf-diff` and `npm run eval:match` run the real reconciliation for your plans.
Before trusting any dollar figure, see [`docs/COMPLIANCE_NOTES.md`](docs/COMPLIANCE_NOTES.md) (subsidy
constants are `verify: true`; the live API APTC/CSR is authoritative).

## Deploy → affinity.pwr-labs.ai

The app is a **stateless web service** (no database needed — nothing is stored). [`render.yaml`](render.yaml)
is ready.

1. Render → **New → Blueprint** → point at `PWR-LABS/affinity`. It builds (`npm ci --include=dev && npm run build`)
   and serves (`npm run start`), health-checked at `/api/health`.
2. In the service&rsquo;s env, set **`MARKETPLACE_API_KEY`** (the free key; rotates every 60 days).
3. Service **Settings → Custom Domains** → add `affinity.pwr-labs.ai`; add a **CNAME** on `pwr-labs.ai` → the
   Render hostname.
4. **Before public launch:** email the Marketplace API team (marketplace-api@cms-provider-directory.uservoice.com)
   to confirm public-free-consumer use + attribution (see [`docs/COMPLIANCE_NOTES.md`](docs/COMPLIANCE_NOTES.md)).

Live, the tool is: **/** the Medicaid-or-Marketplace eligibility check · **/plans** the doctor/drug-aware plan
board · **/verify** the readiness-gated employer doctor checker · **/verify/medicare-drug** the readiness-gated
CMS Part D formulary shortlist and exact-plan checker · **/how-it-works**. Free, neutral, no accounts, no
stored PII.

## Doctrine

Live doctrine: **[[affinity.] product doctrine](https://www.notion.so/p/38250bc7783281338c31f0232753d51f)**.

Part of the **[PWR] LABS** portfolio — the green **biotech + healthcare** family, on the shared **[nucleus.]** design language.
