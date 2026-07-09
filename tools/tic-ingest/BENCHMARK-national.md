# SPEC-10 National TiC Parse Benchmark

Run date: 2026-07-09

This is a read-only measurement of the existing `tic-extract.ts` path. Raw outputs and helper JSON live under
ignored `.data/bench/` and are not committed.

## Inputs

Commands were run from `tools/tic-ingest/` with:

```sh
node --max-old-space-size=512 node_modules/.bin/tsx tic-extract.ts --in <url> --out .data/bench/<name>.ndjson
```

Live HEAD sizes:

| input | source | GB-gz |
| --- | --- | ---: |
| Cigna PathWell-OAP shared file | `issuers.resolved.ndjson` key `cigna`, `sampleFileLocations[2]` | 1.565 |
| UHC Core-EPO shared TPA file | first in-network file from the `1-800-RADIATOR...` employer index | 8.923 |
| Aetna sample shared file | `issuers.resolved.ndjson` key `aetna`, first sample | 3.268 |
| HCSC sample shared file | first in-network file from the first HCSC sample index | 0.033 |
| Florida Blue sample shared file | `issuers.resolved.ndjson` key `flblue`, first sample | 0.144 |

## Parse Results

`tic-extract.ts` does not report byte progress, only `rows`, `npis`, and RSS every 10 seconds. For runs that
were stopped, MB/s is therefore an effective upper bound: `input_gz_MB / elapsed_seconds`.

| file | GB-gz | parse seconds | MB/s-gz | memberships | distinct NPIs | peak RSS MB | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Cigna PathWell-OAP | 1.565 | >3560 | <0.440 | >=943819 | >=643728 | 779 | Stopped after ~59.3 min; no final output written. First rows appeared at ~1000s. |
| UHC Core-EPO 578 | 8.923 | 280 observed | n/a | 0 | 0 | 389 | Stopped after observation window; still in first pass with no row emission. |

Interpretation:

- Cigna proved streaming behavior under `--max-old-space-size=512`, but did not stay under 512 MB RSS.
- Cigna did not complete in a sane operator window. At the observed upper-bound throughput, the single UHC
  8.923 GB file projects to more than 5.6 hours for one worker, before accounting for UHC-specific shape.
- The current extractor writes only after parsing and sorting all retained pairs, so interrupted long runs do
  not leave a usable partial NDJSON.

## UHC Employer-To-Shared-File Dedup

Sample method: first 200 `_index.json` entries from the live UHC blob catalog
`https://transparency-in-coverage.uhc.com/api/v1/uhc/blobs/`.

| metric | value |
| --- | ---: |
| UHC catalog employer index entries | 67111 |
| sampled employer indexes | 200 |
| total `in_network_files[].location` references in sample | 1418 |
| distinct shared network files in sample | 44 |
| references per distinct shared file | 32.2 |
| employers per distinct shared file | 4.5 |
| min / avg / max files per employer index | 1 / 7.09 / 25 |
| HEAD total for the 44 distinct shared files | 278.540 GB-gz |

This confirms the important structure: UHC does not require parsing 67111 unique employer-specific rate
files. But the deduped shared-file set is still large; in this 200-employer sample alone, the distinct shared
files total 278.540 GB-gz.

## Locked B+C Cost Model

Anchors used as fixed inputs:

- `TicMembership` footprint: 280 bytes per row all-in.
- Throughput: use the Cigna observed upper bound, 0.440 MB/s-gz = 1.583 GB-gz/core-hour. Because Cigna was
  stopped before completion, this is optimistic.
- Compute price: spot worker assumption $0.03/core-hour. Render Workflow reference: Standard is $0.20/hour for
  1 CPU / 2 GB RAM.
- Render Postgres pricing: flexible storage is $0.30/GB-month; current paid instances include Pro-4GB at
  $55/month and Pro-8GB at $100/month.

Top-5 sampled shared-file scope:

| component | GB-gz |
| --- | ---: |
| UHC 44 distinct shared files from the 200-employer sample | 278.540 |
| Cigna PathWell-OAP | 1.565 |
| Aetna sample | 3.268 |
| HCSC sample | 0.033 |
| Florida Blue sample | 0.144 |
| total modeled shared files | 283.550 |

Derived model:

| item | formula | result |
| --- | --- | ---: |
| monthly parse compute | 283.550 GB / 1.583 GB/core-hour | 179.1 core-hours |
| spot compute | 179.1 core-hours * $0.03 | $5.37 |
| Render Workflow compute reference | 179.1 core-hours * $0.20 | $35.83 |
| membership rows | 283.550 GB * >=602998 rows/GB | >=171.0M rows |
| DB storage | 171.0M rows * 280 bytes | >=47.9 GB |
| Render storage | 47.9 GB * $0.30 | $14.36/month |
| Render DB serving range | Pro-4GB to Pro-8GB plus storage | $69-$114/month |
| all-in with spot workers | DB range + spot compute | $75-$120/month |
| all-in with Render Workflow compute | DB range + workflow compute | $105-$150/month |

## Go / No-Go Read

Cost is a tentative GO: the B+C hybrid still appears capable of landing below the earlier $150-$250/month
envelope if rows/GB from Cigna is representative and if the deduped shared-file set does not explode beyond
the sampled UHC structure. Implementation is a NO-GO for the current `tic-extract.ts` path as the build
engine: the 1.5 GB Cigna file did not finish after ~59 minutes, peak RSS exceeded 512 MB, and one UHC shared
file projects to hours on a single worker. The next build spec should keep the B+C plan, but add byte-level
progress, resumable per-file workers, true streaming output or direct `COPY`, no all-pairs sort barrier, and
explicit RSS limits before attempting a national monthly ingest.

## Reproduction Notes

- Cigna progress log: `.data/bench/cigna-pathwell.log`
- UHC observation log: `.data/bench/uhc-shared.log`
- UHC dedup sample: `.data/bench/uhc-dedup.json`
- UHC distinct HEAD totals: `.data/bench/uhc-distinct-heads.json`
- Model calculations: `.data/bench/model.json`

These files are local measurement artifacts under ignored `.data/`; only this report is checked in.
