# SPEC-4 — `dol5500-employers`: DOL Form 5500 CSVs → employer-name→EIN lookup table

Build a TypeScript CLI (`tsx dol5500-employers.ts`) in this dir (conventions per `README.md`: stream-json +
Node built-ins only, constant memory, byte-exact fixtures, extend `test.ts` without breaking prior tests).

## Why (one line of context)
Employer health plans are keyed by the employer's EIN, which employees don't know. The public DOL Form 5500
filings map **sponsor (employer) name → EIN**, so a user can type "Kroger" instead of a tax ID.

## Input
The DOL EBSA **Form 5500 datasets** (public CSVs, published yearly as `f_5500_YYYY_latest.csv` and
`f_5500_sf_YYYY_latest.csv` — the short-form has the same sponsor fields). The tool takes:
- `--in <path>` — one or more CSVs (repeatable flag). Header row present; **resolve columns BY HEADER NAME,
  case-insensitively** (layouts drift year to year); fail fast with a clear list of missing columns.
  Canonical names (verify against the DOL layout docs; accept both 5500 and 5500-SF variants):
  `SPONSOR_DFE_NAME`, `SPONS_DFE_EIN`, `SPONS_DFE_MAIL_US_STATE`, `PLAN_NAME`,
  `TYPE_WELFARE_BNFT_CODE`, and the active-participant count (`TOT_ACT_PARTCP_BOY_CNT` or the closest
  present variant — pick by name match, document which).
- `--health-only` (default ON, `--no-health-only` to disable): keep only rows whose welfare benefit code
  list contains `4A` (health insurance) — 5500s also cover 401(k)s etc., which are noise here.
- `--out <path>` (default `employers.ndjson`).

## Normalization
`name_norm` = uppercase → strip punctuation → collapse whitespace → drop trailing corporate suffix tokens
(`INC INCORPORATED LLC LLP LP LTD CORP CORPORATION CO COMPANY PC PLLC PA GROUP HOLDINGS THE`, repeatedly,
but never empty the name). Keep the original `name` verbatim.

## Output — NDJSON, one line per distinct (ein, name_norm)
```json
{"ein":"310675386","name":"THE KROGER CO","name_norm":"KROGER","state":"OH","plan_name":"KROGER HEALTH & WELFARE PLAN","participants":420000,"form":"5500","plan_year":2025}
```
- EIN: digits only, 9 chars; drop rows with invalid EINs (count them).
- Dedup on `(ein, name_norm)`: keep the row with the **largest participants** (the main plan).
- Sort lines by `name_norm`, then `ein`. Deterministic byte-identical output.
- Stderr summary JSON: `{rows_scanned, kept, dropped_non_health, dropped_bad_ein, employers_emitted, seconds, peak_rss_mb}`.

## Acceptance
- Build TWO synthetic fixtures yourself (`fixtures/dol5500-sample.csv`, `fixtures/dol5500-sf-sample.csv`,
  ~10 rows each; all values synthetic) covering: a health 4A row, a non-health row (dropped under
  `--health-only`), a bad EIN, two spellings of one employer that normalize to the same `name_norm`
  (dedup keeps larger participants), a quoted name with a comma, and a suffix-stripping case. Commit the
  byte-exact `fixtures/expected-employers.ndjson` produced from BOTH files in one invocation.
- A generated 2 GB CSV (repeat rows) completes under `node --max-old-space-size=256` (the dedup map holds
  ~1–2M small entries — fine; the STREAM must not buffer rows).
- All prior tool tests still pass via `npm test`.
