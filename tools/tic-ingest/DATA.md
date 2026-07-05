# DOL 5500 Employer Lookup Data

Generated locally from the DOL EBSA Form 5500 datasets page:

- 2025 Form 5500 latest: `https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_2025_Latest.zip`
- 2025 Form 5500-SF latest: `https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_SF_2025_Latest.zip`

Commands run from `tools/tic-ingest/`:

```sh
mkdir -p .data
curl -L --fail --retry 3 -o .data/F_5500_2025_Latest.zip 'https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_2025_Latest.zip'
curl -L --fail --retry 3 -o .data/F_5500_SF_2025_Latest.zip 'https://askebsa.dol.gov/FOIA%20Files/2025/Latest/F_5500_SF_2025_Latest.zip'
unzip -o .data/F_5500_2025_Latest.zip -d .data/5500
unzip -o .data/F_5500_SF_2025_Latest.zip -d .data/5500sf
npx tsx dol5500-employers.ts --in .data/5500/f_5500_2025_latest.csv --in .data/5500sf/f_5500_sf_2025_latest.csv --out .data/employers.ndjson
```

Run summary:

```json
{"rows_scanned":334743,"kept":2188,"dropped_non_health":332555,"dropped_bad_ein":0,"employers_emitted":2008,"seconds":1.99,"peak_rss_mb":122}
```

Generated files under `.data/` are local/regenerable and intentionally ignored by git.

# CMS Part D Formulary PUF

The SPEC-7 tool reads the CMS Monthly Prescription Drug Plan Formulary and Pharmacy Network Information PUF.
The current spec URL is:

- `https://data.cms.gov/sites/default/files/2026-06/72a58ff7-527b-4b6b-a89c-700099d78122/2026_20260610.zip`

The CLI accepts either the zip or an extracted directory:

```sh
npx tsx partd-formulary.ts --in .data/2026_20260610.zip --out-dir .data/partd
```

Zip input is streamed with the system `unzip` command: `unzip -Z1` lists members and `unzip -p` streams only
the selected files. No whole-archive extraction is required. The matched members are resolved
case-insensitively after normalizing punctuation and path separators:

- `basic drugs formulary`
- `plan information`

For plan geography, output prefers the first populated key in this order: `state`, `county_code`, `region`.
The formulary scanner deduplicates on `formulary_id|rxcui` and keeps the first row. Memory use is therefore
mostly the retained unique key plus JSON-line map; the 512 MB ceiling test uses repeated rows to exercise
streaming over a 2 GB pipe-delimited input without growing the dedup set with every scanned row.

# Issuer Registry

`issuers.seed.json` is the checked-in national commercial issuer seed. The spec only provides transparency
landing pages, not machine-readable index URLs, so unresolved `indexUrl` values are intentionally preserved
as `null` until a human resolves and cites each TOC URL. Running the validator still emits one
`issuers.resolved.ndjson` row per seed entry so the registry records gaps honestly.

Command run from `tools/tic-ingest/`:

```sh
npx tsx issuer-registry.ts --in issuers.seed.json --out issuers.resolved.ndjson --probe-rates
```

The memory ceiling test generates a synthetic 2 GB TiC index and runs:

```sh
node --max-old-space-size=256 node_modules/.bin/tsx issuer-registry.ts --in <seed> --out <out> --full-count
```

The validator streams JSON tokens, retaining only counters and the first three sampled rate-file locations.
Its stderr summary includes `peak_rss_mb` for documenting the ceiling run.

Observed standalone SPEC-8 ceiling run:

```json
{"generated_bytes":2147484361,"expected_files":2180187}
{"entries":1,"validated":1,"reachable":1,"unresolved":0,"seconds":5.254,"peak_rss_mb":125}
```

## Part D real-file note (SPEC-7)

The CMS monthly PUF is a **zip of zips**: the outer `2026_YYYYMMDD.zip` contains
`basic drugs formulary file  <date>.zip` and `plan information  <date>.zip`, each
wrapping a single pipe-delimited `.txt`. `partd-formulary.ts --in <zip>` reads the
outer zip's members directly, so it sees the inner zips (not the .txt) and reports
missing columns. Until the tool learns nested-zip unwrapping, extract first:

```sh
mkdir -p flat && cd inner_extract
unzip -o '2026_*.zip' 'basic drugs formulary file*.zip' 'plan information*.zip'
unzip -o 'basic drugs formulary file*.zip' -d ../flat/
unzip -o 'plan information*.zip' -d ../flat/
cd .. && npx tsx partd-formulary.ts --in flat --out-dir out
```

June 2026 file → 1,124,586 formulary rows · 5,821 plans.
