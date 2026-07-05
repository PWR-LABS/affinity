# SPEC-7 — `partd-formulary`: CMS Part D monthly PUF → formulary + plan NDJSON

Build a TypeScript CLI (`tsx partd-formulary.ts`) in this dir (conventions per `README.md`; extend
`test.ts` without breaking the existing tests). This opens affinity's Medicare segment: "is drug X on
Part D plan Y — at what tier, and does it need prior auth / step therapy / quantity limits?"

## Source
CMS **"Monthly Prescription Drug Plan Formulary and Pharmacy Network Information"** PUF (data.cms.gov;
current file: `https://data.cms.gov/sites/default/files/2026-06/72a58ff7-527b-4b6b-a89c-700099d78122/2026_20260610.zip`,
~2.1 GB zip). Inside are **pipe-delimited** text files; resolve members by filename pattern,
case-insensitively (names drift; document what you matched):
- **basic drugs formulary** file (`...basic drugs formulary...`) — one row per (FORMULARY_ID, RXCUI):
  columns include `FORMULARY_ID`, `FORMULARY_VERSION`, `CONTRACT_YEAR`, `RXCUI`, `NDC`, `TIER_LEVEL_VALUE`,
  `QUANTITY_LIMIT_YN`, `QUANTITY_LIMIT_AMOUNT`, `QUANTITY_LIMIT_DAYS`, `PRIOR_AUTHORIZATION_YN`,
  `STEP_THERAPY_YN`. Resolve BY HEADER NAME; fail fast listing missing columns.
- **plan information** file (`...plan information...`) — one row per plan: `CONTRACT_ID`, `PLAN_ID`,
  `SEGMENT_ID`, `PLAN_NAME`, `FORMULARY_ID`, `PREMIUM`, `DEDUCTIBLE`, plus state/region columns
  (`STATE`/`COUNTY_CODE`/region — take what exists, document).
- Ignore pricing / pharmacy-network members for v1 (no rates in the index, per product doctrine).

## CLI
`tsx partd-formulary.ts --in <zip path> --out-dir <dir>` (accept an already-extracted dir via `--in <dir>`
too). Stream zip members without extracting the whole archive to disk where feasible; otherwise document
temp usage and clean up.

## Outputs (both sorted + deterministic)
- `partd-formulary.ndjson` — `{"formulary_id":"...","contract_year":2026,"rxcui":"1593856","tier":3,"prior_authorization":true,"step_therapy":false,"quantity_limit":true,"quantity_limit_amount":60,"quantity_limit_days":30}`
  (booleans from the `_YN` columns: `Y`→true, `N`→false, anything else → omit the key — absent means
  unknown, never false). Dedup on (formulary_id, rxcui) keeping the first.
- `partd-plans.ndjson` — `{"contract_id":"S1234","plan_id":"001","segment_id":"0","plan_name":"...","formulary_id":"...","state":"OH"}`
  (state omitted when the layout doesn't carry it; keep whatever geographic key it does).
- Stderr summary JSON: `{formulary_rows, formulary_emitted, plan_rows, plans_emitted, missing_yn_values, seconds, peak_rss_mb}`.

## Acceptance
- Synthetic fixtures you build (`fixtures/partd-formulary-sample.txt`, `fixtures/partd-plans-sample.txt`,
  pipe-delimited, ~10 rows each) covering: Y/N/blank `_YN` values, a duplicate (formulary_id, rxcui),
  tier as number, a plan with and without the state column populated. Byte-exact
  `fixtures/expected-partd-formulary.ndjson` + `expected-partd-plans.ndjson`.
- A generated 2 GB pipe-delimited file completes under `node --max-old-space-size=512` (the formulary
  file has tens of millions of rows — the dedup set of `formulary_id|rxcui` strings is the main memory
  consumer; document its expected size).
- All prior tool tests stay green (`npm test`).
