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

`issuers.seed.json` is the checked-in national commercial issuer seed. SPEC-9 resolves 10 of the top 12
issuer keys to live machine-readable index URLs and keeps unresolved rows as `null` so the registry records
gaps honestly.

Command run from `tools/tic-ingest/`:

```sh
npx tsx issuer-registry.ts --in issuers.seed.json --out issuers.resolved.ndjson --probe-rates --full-count
```

Live SPEC-9 snapshot run on 2026-07-05:

```json
{"entries":35,"validated":10,"reachable":10,"unresolved":25,"seconds":29.678,"peak_rss_mb":133}
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

## Issuer Registry Live Snapshot (SPEC-9)

Counts are from `issuers.resolved.ndjson` generated on 2026-07-05. `countExact:false` means the validator
sampled instead of full-counting an oversized index.

| issuer | index URL | in-network files | schema | note |
| --- | --- | ---: | --- | --- |
| uhc | [blob catalog][uhc-index] | 67111 | v1 | Exact nested per-employer index catalog count. |
| anthem | [July 2026 S3 TOC][anthem-index] | 3 | v1 | Sampled only; current TOC is 10,478,256,319 bytes, so full-count was skipped. |
| aetna | [Aetna Life TOC][aetna-index] | 283 | v1 | Exact HealthSparq ALICFI table-of-contents count. |
| cigna | [signed Cigna Health Life TOC][cigna-index] | 130093 | v1 | Exact count; signed URL came from Cigna `/static/mrf/latest.json`. |
| hcsc | [BCBSIL SI file list][hcsc-index] | 5719 | v1 | Exact nested HCSC state/EIN index catalog count. |
| kaiser | null | - | - | Official KP page is regional; no single top-level index URL resolved. |
| centene | [Ambetter TOC][centene-index] | 28 | unknown | Exact TOC count; sampled rate URLs returned 404 during probe. |
| humana | null | - | - | Official Humana Cost Transparency URL redirected to a syntheticdata page returning HTTP 502. |
| flblue | [Florida Blue issuer TOC][flblue-index] | 3097 | v1 | Exact Health Insurance Issuer TOC count. |
| highmark | [Highmark PA TOC][highmark-index] | 6347 | v1 | Exact Pennsylvania Highmark BCBS TOC count. |
| carefirst | [CareFirst PPO TOC][carefirst-index] | 1050 | unknown | Exact TOC count; sampled signed rate URL returned 403 during probe. |
| bcbsmi | [BCBSM current TOC][bcbsmi-index] | 529 | v1 | Exact Sapphire current redirect target count. |

[uhc-index]: https://transparency-in-coverage.uhc.com/api/v1/uhc/blobs/
[anthem-index]: https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/2026-07-01_anthem_index.json.gz
[aetna-index]: https://mrf.healthsparq.com/aetnacvs-egress.nophi.kyruushsq.com/prd/mrf/AETNACVS_I/ALICFI/2026-07-05/tableOfContents/2026-07-05_Aetna-Life-Insurance-Company_index.json.gz
[cigna-index]: https://d25kgz5rikkq4n.cloudfront.net/cost_transparency/mrf/table-of-contents/reporting_month=2026-07/2026-07-01_cigna-health-life-insurance-company_index.json?Expires=1786802500&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9kMjVrZ3o1cmlra3E0bi5jbG91ZGZyb250Lm5ldC9jb3N0X3RyYW5zcGFyZW5jeS9tcmYvdGFibGUtb2YtY29udGVudHMvcmVwb3J0aW5nX21vbnRoPTIwMjYtMDcvMjAyNi0wNy0wMV9jaWduYS1oZWFsdGgtbGlmZS1pbnN1cmFuY2UtY29tcGFueV9pbmRleC5qc29uIiwiQ29uZGl0aW9uIjp7IkRhdGVMZXNzVGhhbiI6eyJBV1M6RXBvY2hUaW1lIjoxNzg2ODAyNTAwfX19XX0_&Signature=GyhWC~kQYTRoSldJfoOW9u05iSoNgy7jZUqvTi5hqV4o0EL2pFIvW9Y-Mhqr~VOA0or7ZuZnk7wRv7G9d6QvDinuQn3M2VRH9V~E9RXcXkwG1SEHik~5orSiiwd6CHFjxqENNlvFuP6THaqS4nUPQcyUJ1rIHZCafnF1gYv0UNAdWxS9PmBmuoxW2kBGoGI0Dh~tVvIDyUzBdyL3PucjCCBG-ryHLfnU~SE-2OT5FCGRws2N1Q7NyJuqeSOsjwO9AvxP0lHgZtsAZfmlql9Mp-RfhDESmHg6iBsIlYi1du69MeoZ8N3CXQ~WlNL4Dl-MfMpW2XcUoMyYXWDoIVhORw__&Key-Pair-Id=K1NVBEPVH9LWJP
[hcsc-index]: https://www.bcbsil.com/content/dam/bcbs/mrf/si-filelist.json
[centene-index]: https://www.centene.com/content/dam/centene/Centene%20Corporate/json/DOCUMENT/2026-06-29_ambetter_index.json
[flblue-index]: https://d1hgtx7rrdl2cn.cloudfront.net/mrf/toc/FloridaBlue_Health-Insurance-Issuer_index.json
[highmark-index]: https://mrfdata.hmhs.com/files/363/pa/inbound/local/2026-07-01_Highmark_Blue_Cross_Blue_Shield_of_Pennsylvania_index.json
[carefirst-index]: https://stmrffilesprod001.blob.core.windows.net/mrf-files/2026-05-27_carefirst%20ppo_index.json
[bcbsmi-index]: https://bcbsm.sapphiremrfhub.com/tocs/current/blue_cross_blue_shield_of_michigan

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
