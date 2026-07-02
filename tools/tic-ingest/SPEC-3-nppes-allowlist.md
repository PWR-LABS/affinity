# SPEC-3 — `nppes-allowlist`: NPPES bulk CSV → metro NPI allowlist

Build a TypeScript CLI (`tsx nppes-allowlist.ts`) that streams the NPPES **full replacement** CSV
(npidownload from CMS, ~9–10 GB unzipped; the tool must accept the `.csv` already extracted — zip handling
out of scope) and emits an NPI allowlist for one metro, used as `--allowlist` input to `tic-extract`.

## Input
- `--in <path>` — NPPES `npidata_pfile_*.csv` (header row present; columns referenced BY HEADER NAME, not
  index — NPPES adds columns over time).
- Filters (AND-ed):
  - `--state <XX>` — match `Provider Business Practice Location Address State Name`.
  - `--zip-prefixes <csv>` — e.g. `440,441,442` (Cleveland metro); match the first 3–5 chars of
    `Provider Business Practice Location Address Postal Code` (strip non-digits first; NPPES zips are
    5 or 9 digits).
  - `--entity-type <1|2|both>` — `Entity Type Code` (1=individual, 2=org). Default `both`.
  - `--taxonomy-prefixes <csv>` (optional) — prefix-match against `Healthcare Provider Taxonomy Code_1`
    (primary only is fine for the pilot).
- Skip deactivated records (`NPI Deactivation Date` non-empty AND `NPI Reactivation Date` empty).

## Output
- `allowlist.txt` — one NPI per line, sorted ascending, deduped.
- `allowlist.meta.csv` — `npi,entity_type,name,taxonomy_1,city,zip5` (name = org name for type 2, else
  `LAST, FIRST`); same order.
- Stderr summary: rows scanned, matched, deactivated-skipped, seconds.

## Notes
- Proper CSV parsing (quoted fields with commas). Stream line-by-line; constant memory.
- The NPPES header names above are the canonical ones from the CMS data dictionary — resolve them
  case-insensitively and fail fast with a clear error listing missing columns if the header doesn't match.

## Acceptance
- `fixtures/nppes-sample.csv` (~15 rows covering: OH/440xx match, OH/other-zip, other-state, deactivated,
  reactivated, type 1 + 2, quoted name with comma) → byte-identical `fixtures/expected-allowlist.txt` +
  `expected-allowlist.meta.csv` for `--state OH --zip-prefixes 440,441`. **Build this fixture yourself**
  from the NPPES data-dictionary column names; keep every value synthetic.
- A generated 2 GB CSV (repeat rows) completes under `node --max-old-space-size=128`.
