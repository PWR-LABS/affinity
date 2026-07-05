# Fixtures — invocation contract

Expected outputs embed `file_url` as the **relative path** used at invocation. Acceptance runs must be
executed from the tool root exactly as:

```
tsx tic-extract.ts --in fixtures/tic-in-network-v2-sample.json --out out-v2.ndjson   # diff vs fixtures/expected-v2.ndjson
tsx tic-extract.ts --in fixtures/tic-in-network-v1-sample.json --out out-v1.ndjson   # diff vs fixtures/expected-v1.ndjson
tsx toc-manifest.ts --in fixtures/toc-sample.json --out out-manifest.csv             # diff vs fixtures/expected-manifest.csv
tsx nppes-allowlist.ts --in fixtures/nppes-sample.csv --state OH --zip-prefixes 440,441 --out out-allowlist.txt
                                                                                     # diff out-allowlist.txt vs fixtures/expected-allowlist.txt
                                                                                     # diff out-allowlist.meta.csv vs fixtures/expected-allowlist.meta.csv
tsx dol5500-employers.ts --in fixtures/dol5500-sample.csv --in fixtures/dol5500-sf-sample.csv --out out-employers.ndjson
                                                                                     # diff vs fixtures/expected-employers.ndjson
tsx partd-formulary.ts --in fixtures --out-dir out-partd
                                                                                     # diff out-partd/partd-formulary.ndjson vs fixtures/expected-partd-formulary.ndjson
                                                                                     # diff out-partd/partd-plans.ndjson vs fixtures/expected-partd-plans.ndjson
tsx issuer-registry.ts --in fixtures/issuers-seed-sample.json --out out-issuers.resolved.ndjson --probe-rates
                                                                                     # diff vs fixtures/expected-issuers.resolved.ndjson
```

Manifest sort: by `file_url`, then `plan_id`. Rows for structures with only an `allowed_amount_file`
(no in_network_files) do not appear. NDJSON sort: whole-line lexicographic. All diffs must be empty
(byte-identical).

The v2 fixture intentionally contains: an `npi: [0]` sentinel group (dropped), a 9-digit TIN-echo value
`123456789` inside an `npi[]` (dropped, counted as `tin_in_npi_dropped`), and a duplicate (npi, tin) pair
across two `in_network` items (deduped). The v1 fixture contains a solo provider whose `tin.type` is
`"npi"` and whose NPI equals `tin.value` — that one is **kept**.

The SPEC-3 NPPES fixture uses synthetic values only and the canonical CMS data-dictionary column names
referenced by `SPEC-3-nppes-allowlist.md`.

The SPEC-4 DOL fixtures use synthetic values only and cover both Form 5500 and Form 5500-SF header names.

The SPEC-7 Part D fixtures use synthetic values only. The directory input path exercises the fixture aliases
for the real `basic drugs formulary` and `plan information` member patterns, blank/invalid `_YN` handling,
duplicate `(formulary_id, rxcui)` suppression, and plan geography fallback from `state` to `county_code`.

The SPEC-8 issuer-registry fixtures use synthetic issuer names and local paths only. They cover a plain v2
TOC, a gzipped v1 TOC, a valid JSON file that is not a TiC TOC, an unresolved seed entry, and `--probe-rates`
schema sniffing from the first sampled in-network file.
