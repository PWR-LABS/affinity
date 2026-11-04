# Selected Anthem TOCs

This local-only Node 24 tool turns a **complete archived Anthem gzip** into selected per-source TOCs. It never fetches URLs, downloads rates, invents plan mappings from EIN documents, or certifies whole-plan coverage.

Run from this standalone tool package with its locked dependencies:

```sh
node --import tsx selected-toc.ts \
  --in /verified-device/complete-anthem-index.json.gz \
  --selected /verified-device/selected-urls.json \
  --out-dir /verified-device/existing-output-root
node --import tsx --test selected-toc.test.ts
```

The selection file is a JSON array of 1–400 strings: exact full HTTPS URLs or absolute URL paths. Only known CloudFront/AWS signature parameters and empty query separators are ignored. Dates, shards, hosts and semantic query text are preserved. Duplicate identities, overlapping URL/path selections and path matches across different hosts fail closed.

API: `buildSelectedToc({input, selected, outDir, guard?, now?, limits?})`. `guard` is synchronous; `now` is for deterministic tests, while the CLI uses the actual clock. `outDir` must already exist. No root or parent directories are created. Every run uses its own hidden scratch directory and publishes one uniquely named run directory only after full validation.

The token parser checks scalar bytes while chunks stream, nesting, duplicate/unsafe keys and each retained reporting structure's JSON budget/node count. Root metadata and numeric literals retain their source values, including numbers outside JavaScript's safe-integer range. All structures' required plan/file mappings are validated, including unselected structures. Exact selected plan objects are deduplicated in SQLite, retaining every field; they are not reduced to the publisher's four-field tuple. Original reference variants are retained in the projection.

SQLite uses indexed disk tables, an 8 MiB page cache, disabled mmap and a hard page cap. Its database is disposable scratch with journaling disabled; it is never resumed after a crash and is removed before publishing the output directory. Projection readers iterate indexed rows, rather than loading global plan arrays. Limits are explicit and can only be lowered through the API:

| Bound | Default |
| --- | ---: |
| Selected files / exact plan objects per output | 400 / 30,000 |
| Reference variants per output | 64 |
| One collected structure's retained JSON budget / nodes | 8 MB / 100,000 |
| Scalar / depth / root metadata | 65,536 bytes / 32 / 262,144 bytes |
| Complete compressed input / decoded input | 20 GB / 512 GB |
| Temporary logical SQLite-plus-output bytes | 2 GB |
| One projection decoded / gzip | 100 MB / 10 MB |

The retained JSON budget is an allocation bound, not the original wire length of a structure. Temporary byte accounting is logical file/page size, not physical filesystem allocation; the caller's device/free-space guard still applies. Reference validation currently requires HTTPS. Unexpected source schema, stale/future/impossible dates, or legitimate structures exceeding these bounds require review rather than a silent skip.

No TOC gzip or success receipt is written before validated gzip CRC, JSON EOF and the SHA-256 of the **entire compressed input**. File identity/size/timestamps are checked again to reject source modification. Per-source gzip bytes are deterministic for identical source/selection on the tested Node/zlib runtime. Root metadata and all exact reporting-plan objects are retained.

Result: `{directory, receiptPath, parentSha256, projected, unresolved, scope}`.
The protected `receipt.json` contains:

- `parent`: full SHA-256, compressed/decoded counts, metadata, actual source date, validated EOF.
- `selection`: original selection-file SHA-256 and count.
- `projections`: selected URL/path, matched identity, an actual parent `sourceUrl`, relative gzip filename, parent hash, exact plan/reference counts, gzip/decoded hashes and byte counts.
- `unresolved`: selected identities not found anywhere before validated parent EOF. Retirement or replacement is not inferred.
- Limits, observations and peak logical scratch/RSS statistics.

Both TOCs and receipts remain **selected-file-only; whole-plan and national completeness unverified**. They may contain issuer-published signed URLs; keep them outside Git and do not log their bodies. The CLI emits only paths, hashes and counts. Receipts are new projection-lineage evidence; Mini must validate/integrate them with its publication contract before trusting a derived TOC.

Ordinary failures remove only this run's scratch directory. A persistent storage-identity failure refuses deletion on an unverified device and throws `SelectedTocError` with `cleanupPending=true` and `temporaryPath`; cleanup waits for device reconfirmation. There is no overwrite, resume, production write or retirement behavior.

Verification on Node 24.22.1: all **13 selected-TOC tests** and standalone typecheck pass. Correctness tests cover exact metadata/plan variants, signatures versus semantic queries, deterministic output, malformed/truncated gzip/JSON, invalid UTF-8, source-date failures, ambiguous selection, scalar/structure/node/depth/count/output/disk caps, archive modification and transient/persistent disconnects.

The bounded-memory fixture preserved **60,000 distinct plan objects with 2 KiB payloads**, processing **142,210,161 decoded bytes** under `--max-old-space-size=64`. Peak RSS was **117.27 MiB**, and peak logical scratch was **280,649,539 bytes**. This is a synthetic memory result, not real Anthem throughput or acceptance. No complete Anthem archive was processed on Air. Mini owns the first real-archive review/run and any publisher or runner integration.
