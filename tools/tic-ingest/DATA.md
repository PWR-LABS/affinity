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
