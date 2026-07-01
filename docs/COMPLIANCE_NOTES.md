# [affinity.] — compliance & open questions

Honest, living checklist of the legal/regulatory/data items to resolve **before** any commercial launch
or before presenting a number as authoritative. Nothing here is legal advice; these are flags for the
operator to verify. Mirrors the risks in `docs/AFFINITY_PRODUCT_VISION.md` §9 and the doctrine
non-negotiables.

## 1. Marketplace API Terms of Use — **CLEARED for a live, free consumer tool** (one item to confirm pre-launch)

The HealthCare.gov Marketplace API (`developer.cms.gov/marketplace-api`) powers plan/provider/drug/
eligibility data. Findings (CMS developer docs, reviewed 2026-06-30):

- ✅ **Intended for exactly this use.** The API "drives Window Shop and Plan Compare on HealthCare.gov" and
  is "designed to support **live access by front-end applications**." A public, free, consumer-facing tool is
  its purpose — third-party consumer apps (HealthSherpa, Stride, etc.) run on it. No prohibition on free
  public use found.
- ⚠️ **Live access only — NOT for scraping / bulk extraction.** It is "**not designed to be scraped or for the
  whole data set to be extracted.**" → Architecture invariant: query **live per user request**; do NOT
  pre-download/mirror the full plan or MRF dataset. Our model (per-request) is compliant; keep caching short
  and per-query (not a bulk mirror).
- ⚠️ **Rate limited.** The limit is returned in response headers; the key rotates every 60 days. A public tool
  must respect it — implement per-query caching, handle 429s, and email the team
  (marketplace-api@cms-provider-directory.uservoice.com) to raise the limit if needed.
- ☐ **One item to confirm before public launch:** the full formal Terms of Use / attribution requirements are
  not posted on the public dev pages (the key-request form captures intended use). Email the Marketplace API
  team to confirm public-free-consumer use + our caching approach and ask whether attribution text is
  required. **Low risk — does not block building; resolve before the public domain goes live.**

**Net: green to build the live public tool** on a per-request model with caching + rate-limit handling.

## 2. Regulatory line: decision-support vs. enrollment — **design invariant**

- Information / decision-support is unlicensed-safe. **"Enroll here"** (placing a person on a plan) needs
  broker licensing or an EDE / licensed partner. Keep the product on the decision-support side: rank,
  explain, tell the user what to confirm, then hand off to the official Marketplace.
- **Neutrality is the brand**: no commissions, no broker funnel, no plan kickbacks — enforced by the
  doctrine and the absence of any commission/affiliate code path. Do not add one.

## 3. Coverage claims — **enforced in code**

- Never present in-network / on-formulary as fact. Every coverage answer carries source + freshness +
  confidence and tells the user to confirm (the `provenance` + `verify` layers; `eval:m0-smoke` asserts
  no bare claim renders).

## 4. Subsidy / cost figures — **verify before showing as authoritative**

- `POLICY_2026` (`src/lib/cost/policy.ts`) is flagged `verify: true`: the FPL, the §36B
  applicable-percentage schedule, and the CSR bands are placeholders pending the plan-year IRS Rev. Proc.
- In live mode the **Marketplace API eligibility estimate (APTC/CSR) is authoritative** and supersedes the
  placeholder math; validate the engine output against the **KFF calculator** before any dollar figure is
  shown to a user as more than an estimate.

## 5. Privacy / PII — **doctrine**

- Health + income data is the user's. Minimize and protect it; **never put PII in URLs, query strings, or
  logs**. Identifiers are cuids, never household data (schema-enforced).

---

_Last reviewed: 2026-06-17 (M0–M3 + hardening). Re-review before Phase-2 productization._
