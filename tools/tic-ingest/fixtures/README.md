# Fixtures — invocation contract

Expected outputs embed `file_url` as the **relative path** used at invocation. Acceptance runs must be
executed from the tool root exactly as:

```
tsx tic-extract.ts --in fixtures/tic-in-network-v2-sample.json --out out-v2.ndjson   # diff vs fixtures/expected-v2.ndjson
tsx tic-extract.ts --in fixtures/tic-in-network-v1-sample.json --out out-v1.ndjson   # diff vs fixtures/expected-v1.ndjson
tsx toc-manifest.ts --in fixtures/toc-sample.json --out out-manifest.csv             # diff vs fixtures/expected-manifest.csv
```

Manifest sort: by `file_url`, then `plan_id`. Rows for structures with only an `allowed_amount_file`
(no in_network_files) do not appear. NDJSON sort: whole-line lexicographic. All diffs must be empty
(byte-identical).

The v2 fixture intentionally contains: an `npi: [0]` sentinel group (dropped), a 9-digit TIN-echo value
`123456789` inside an `npi[]` (dropped, counted as `tin_in_npi_dropped`), and a duplicate (npi, tin) pair
across two `in_network` items (deduped). The v1 fixture contains a solo provider whose `tin.type` is
`"npi"` and whose NPI equals `tin.value` — that one is **kept**.

SPEC-3's NPPES fixture is built by the implementer (synthetic values only) per the spec.
