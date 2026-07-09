# SPEC-10 — TiC parse-throughput benchmark: lock the "go-national" cost model

**This is a MEASUREMENT task, not the build.** Produce hard numbers so the operator can make a go/no-go on
nationwide commercial coverage. The fan-out ingest pipeline is a LATER spec, explicitly gated on this report.

## Why
Sizing the "B+C hybrid" (pre-ingest the shared-network giants monthly + on-demand-cache the small per-employer
tail) needs exactly one measured variable: **how fast can we stream-parse a giant v1 in-network file, and how
many memberships come out per GB?** Every other input is already anchored.

## Anchors to build on — DO NOT re-derive
- `TicMembership` real footprint: **~280 bytes/row all-in** (table + indexes), measured on the Ohio pilot.
- Real gz file sizes (HEAD, 2026-07-09): **UHC** shared-network rate file **8.9 GB gz**; **Cigna** PathWell-OAP
  **1.5 GB gz**; a per-*employer* Cigna file **4.5 MB gz**.
- Structure finding to CONFIRM: the 214K "in-network files" are mostly *tiny per-employer index pointers* to a
  *small deduped set* of giant shared-network files. UHC's employer index lists 5 files, all the shared
  `United-HealthCare-Services_Third-Party-Administrator` networks that every employer reuses.

## Benchmark tasks — use the existing `tic-extract.ts` (SPEC-2): streams from a URL, discards rates, emits (npi, tin, file)
1. **Throughput @ 1.5 GB (Cigna PathWell-OAP).** `node --max-old-space-size=512 …/tsx tic-extract.ts --in <url> --out <tmp>`.
   Record: wall-clock, **MB/s of gzipped input**, memberships emitted, distinct NPIs, peak RSS.
2. **Throughput @ 8.9 GB (UHC shared TPA network).** Same, still under `--max-old-space-size=512` — proving a
   9 GB file streams without blowing memory is itself a key result. If it won't finish in a sane window, capture
   sustained MB/s from the tool's 10s progress lines and extrapolate; document that.
3. **Dedup / shared-file structure.** Fetch ~200 UHC employer indexes from the catalog and count the number of
   **distinct** `in_network_files[].location` they reference. Report the ratio (e.g. "200 employers → N distinct
   network files"). This is what bounds the REAL ingest scope — a small deduped set, not 67K.
4. **Yield → rows → storage.** From the parsed output: memberships per GB-gz and distinct-NPIs per GB.
   Extrapolate to the top-5 carriers' deduped shared files → total rows → GB @ 280 b/row.

## URLs (valid 2026-07-09; if a signed URL 403s, refresh by re-running `issuer-registry.ts` or re-fetching the index)
- **Cigna 1.5 GB** = `issuers.resolved.ndjson` → key `cigna` → `sampleFileLocations[2]` (cloudfront `pathwell-oap…json.gz`, signed to 2036).
- **UHC 8.9 GB** = GET the employer index
  `https://transparency-in-coverage.uhc.com/api/v1/uhc/blobs/download/2026-07-01/2026-07-01_1-800-RADIATOR-OF-DALLAS-FORT-WORTH-LLC_index.json`
  → take `reporting_structure[0].in_network_files[0].location` (unsigned, stable).
- **Others** (aetna, hcsc, flblue — for the top-5 extrapolation): HEAD one sample rate file each from their
  `sampleFileLocations` in `issuers.resolved.ndjson` to get gz sizes (no full parse needed).

## Deliverable — `tools/tic-ingest/BENCHMARK-national.md` (checked in)
- Table: file → GB-gz → parse seconds → MB/s → memberships → distinct NPIs → peak RSS.
- The dedup ratio from task 3.
- **The locked cost model** for B+C: (a) monthly ingest compute = deduped-shared-GB ÷ measured throughput →
  core-hours → $ range (state your $/core-hr assumption, e.g. spot ~$0.03/core-hr); (b) serving DB =
  extrapolated rows × 280 b/row → GB → Render $ range; (c) one-line all-in $/month.
- One-paragraph go/no-go: does B+C land in the **~$150–250/mo** we estimated, or not?

## Constraints
- **Read-only.** No DB writes, no Postgres load, no infra. Parse to a temp NDJSON and measure; **do not commit
  the multi-GB outputs** — only `BENCHMARK-national.md`.
- Stream from URL (never land the 9 GB on disk); confirm peak RSS stays bounded. Note total bytes moved.
- `npm test` must stay green (this adds no tool code; if you touch `tic-extract.ts`, keep all tests passing).

## Out of scope (explicitly — do NOT build)
The fan-out extraction pipeline, object storage, worker fleet, orchestration, the DB load, and the on-demand
cache layer. All later, gated on this report's go/no-go.
