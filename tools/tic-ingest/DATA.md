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
