# [affinity.] — compliance & open questions

Honest, living checklist of the legal/regulatory/data items to resolve **before** any commercial launch
or before presenting a number as authoritative. Nothing here is legal advice; these are flags for the
operator to verify. Mirrors the risks in `docs/AFFINITY_PRODUCT_VISION.md` §9 and the doctrine
non-negotiables.

## 1. Marketplace API terms — live use, written confirmation still open

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
- ⚠️ **Rate limited.** The limit is returned in response headers. CMS's August 2026 operator notice postponed
  the planned October 26, 2026 key rotation until after Open Enrollment; the replacement date is TBD in 2027.
  Treat rotation as notice-driven and update the deployed secret promptly when CMS supplies the new date. A public
  tool must respect the limit — implement per-query caching, handle 429s, and email the team
  (marketplace-api@cms-provider-directory.uservoice.com) to raise the limit if needed.
- ☐ **Open despite the public deployment:** we have not recorded written confirmation of the complete
  Terms of Use, attribution requirements, and permitted caching. Contact the Marketplace API team with
  the current free consumer use, per-request architecture, and source-cache behavior. Record their
  response before an institutional pilot or any commercial use. Do not describe this as cleared.

The public developer pages describe third-party applications and rate limits. They are not a substitute
for the specific terms and attribution confirmation above.

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

## 5. Privacy / PII — current controls and pilot gate

- Health and income data is the user's. The app does not store submitted household answers or deliberately
  log request bodies. The public site has no accounts. Doctor and medication typeahead use POST to keep
  search terms out of [affinity.] URLs. Analytics code was removed from the public site.
- The server forwards relevant request data to CMS, and medication search terms to NLM RxTerms. Hosting
  infrastructure processes connection metadata. The public `/privacy` page explains these boundaries;
  it does not substitute for an institutional data-flow and retention review.
- Before any UH-sponsored workflow or real patient information: inventory every processor and log,
  settle retention and incident response, classify the data, and obtain UH privacy/security approval.

---

_Updated: 2026-09-30. External terms and institutional privacy review remain open._
