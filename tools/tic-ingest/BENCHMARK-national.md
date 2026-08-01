# SPEC-10 National TiC Parse Benchmark

Original run date: 2026-07-09  
Extractor-v2 follow-up: 2026-07-15

This is a read-only measurement. Raw outputs and helper JSON live under ignored `.data/bench/` and are not
committed.

## Inputs

Commands were run from `tools/tic-ingest/` with:

```sh
node --max-old-space-size=512 node_modules/.bin/tsx tic-extract.ts --in <url> --out .data/bench/<name>.ndjson
```

Live HEAD sizes from the original benchmark:

| input | source | GB-gz |
| --- | --- | ---: |
| Cigna PathWell-OAP shared file | `issuers.resolved.ndjson` key `cigna`, `sampleFileLocations[2]` | 1.565 |
| UHC Core-EPO shared TPA file | first in-network file from the `1-800-RADIATOR...` employer index | 8.923 |
| Aetna sample shared file | `issuers.resolved.ndjson` key `aetna`, first sample | 3.268 |
| HCSC sample shared file | first in-network file from the first HCSC sample index | 0.033 |
| Florida Blue sample shared file | `issuers.resolved.ndjson` key `flblue`, first sample | 0.144 |

## Original Parse Results

The original `tic-extract.ts` did not report byte progress, only rows, NPIs, and RSS every 10 seconds. For
stopped runs, MB/s is therefore an effective upper bound: `input_gz_MB / elapsed_seconds`.

| file | GB-gz | parse seconds | MB/s-gz | memberships | distinct NPIs | peak RSS MB | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Cigna PathWell-OAP | 1.565 | >3560 | <0.440 | >=943819 | >=643728 | 779 | Stopped after about 59.3 min; no final output written. First rows appeared at about 1000s. |
| UHC Core-EPO 578 | 8.923 | 280 observed | n/a | 0 | 0 | 389 | Stopped after observation window; still in first pass with no row emission. |

Interpretation:

- Cigna proved streaming behavior under `--max-old-space-size=512`, but did not stay under 512 MB RSS.
- Cigna did not complete in a sane operator window. At the observed upper-bound throughput, the single UHC
  8.923 GB file projected to more than 5.6 hours for one worker, before accounting for UHC-specific shape.
- The original extractor wrote only after parsing and sorting all retained pairs, so interrupted long runs did
  not leave usable partial work.

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

## Original Locked B+C Cost Model

Anchors used as fixed inputs:

- `TicMembership` footprint: 280 bytes per row all-in.
- Throughput: Cigna observed upper bound, 0.440 MB/s-gz = 1.583 GB-gz/core-hour. Because Cigna was stopped
  before completion, this was optimistic for the original implementation.
- Compute price: spot worker assumption $0.03/core-hour. Render Workflow reference: Standard is $0.20/hour
  for 1 CPU / 2 GB RAM.
- Render Postgres pricing: flexible storage is $0.30/GB-month; the paid-instance references used were Pro-4GB
  at $55/month and Pro-8GB at $100/month.

Top-five sampled shared-file scope:

| component | GB-gz |
| --- | ---: |
| UHC 44 distinct shared files from the 200-employer sample | 278.540 |
| Cigna PathWell-OAP | 1.565 |
| Aetna sample | 3.268 |
| HCSC sample | 0.033 |
| Florida Blue sample | 0.144 |
| total modeled shared files | 283.550 |

Original derived model:

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

The original locked read was a tentative cost GO and an implementation NO-GO for the old extractor.

## Extractor-v2 Follow-up

Extractor v2 replaces file-wide JavaScript maps with append-only disk spools, external bounded-memory sort,
a streaming v1 reference merge, atomic final output, byte-level progress, and durable parse checkpoints. The
same CLI and output schema are preserved.

Measured real-file results under `node --max-old-space-size=512`:

| file | GB-gz | end-to-end seconds | MB/s-gz | memberships | distinct NPIs | peak RSS MB | result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| HCSC sample shard | 0.033 | 31.628 | 1.045 | 66904 | 51826 | 229 | Completed, including sort and materialization. |
| Cigna PathWell-OAP | 1.565 | 1333.700 | 1.174 | 2693427 | 1755198 | 246 | Completed, including sort and materialization. |

Cigna improvement versus the original run:

- End-to-end completion in 22m 14s instead of no completion after 59m 20s.
- 246 MB peak RSS instead of 779 MB, leaving 266 MB below the strict 512 MB ceiling.
- 1.174 MB/s-gz end to end, more than 2.6x the original run's upper-bound effective throughput.
- Interrupted work is retained in `<out>.work/`; a gzip resume replays bytes from the beginning but skips
  provider/reference units already committed to the spool.
- The final Cigna NDJSON was about 1.9 GB locally. National workers therefore need scratch space for the raw,
  sorted, and final files even though their RAM stays bounded; the output itself was deleted after measurement.

The completed Cigna yield is 1.721M memberships/GB-gz and 1.121M distinct NPIs/GB-gz. Using that actual yield
and throughput updates the same top-five model as follows:

| item | formula | updated result |
| --- | --- | ---: |
| measured parse capacity | 1.565 GB / 0.3705 core-hours | 4.225 GB/core-hour |
| monthly parse compute | 283.550 GB / 4.225 GB/core-hour | 67.1 core-hours |
| spot compute | 67.1 core-hours * $0.03 | $2.01 |
| Render Workflow compute reference | 67.1 core-hours * $0.20 | $13.42 |
| membership rows | 283.550 GB * 1.721M rows/GB | about 487.9M rows |
| DB storage | 487.9M rows * 280 bytes | about 136.6 GB |
| Render storage | 136.6 GB * $0.30 | about $40.99/month |
| all-in with spot workers | prior $55-$100 serving tier + storage + compute | about $98-$143/month |
| all-in with Render Workflow compute | prior $55-$100 serving tier + storage + compute | about $109-$154/month |

The extractor implementation is now a GO for bounded per-file workers. The B+C cost read remains a tentative
GO near the upper edge of the prior range: faster compute is offset by a much higher measured membership
yield and therefore more database storage. This is not yet a nationwide-system GO. Before fan-out, complete
one UHC shared file and a database load/query pilot; 487.9M modeled rows may require a larger serving tier than
the original Pro-4GB/Pro-8GB placeholder even though storage arithmetic remains inside the earlier envelope.

## Reproduction Notes

Original local-only evidence:

- `.data/bench/cigna-pathwell.log`
- `.data/bench/uhc-shared.log`
- `.data/bench/uhc-dedup.json`
- `.data/bench/uhc-distinct-heads.json`
- `.data/bench/model.json`

Extractor-v2 output files were used only to verify counts and were not committed. The checked-in artifact is
this report.
