# SPEC-9 — resolve the live TiC index URLs (turn the registry into real evidence)

SPEC-8 shipped the validator and it's green, but every row in `issuers.resolved.ndjson` is
`"indexUrl":null → "unresolved"` — the tool has not yet touched a single live issuer. This chunk fills in
the **real machine-readable index URLs** for the biggest carriers and re-runs the validator, producing the
**first real evidence table** that tells us the true national ingest size (reachable? how many in-network
files? schema v1 vs v2?) — the artifact the "should we go nationwide, and what will it cost" decision rides on.

**No new tool.** This is: research the URLs → edit `issuers.seed.json` → re-run `issuer-registry.ts`.

## Scope — the top 12 (≈ 85–90% of commercially-insured lives)
Resolve these keys (already in `issuers.seed.json`): `uhc`, `anthem`, `aetna`, `cigna`, `hcsc`, `kaiser`,
`centene`, `humana`, `flblue`, `highmark`, `carefirst`, `bcbsmi`. Getting **≥10 of 12** cleanly resolved is
success. The other 23 stay `null` (honest gaps) — a later chunk does the tail.

## How to resolve one issuer's `indexUrl`
Each carrier posts a public **Transparency in Coverage** page that links to a machine-readable **index /
table-of-contents** file (JSON, often `.json.gz`). You want *that* URL — the TOC that lists
`in_network_files[].location` — **not** the human page, and **not** an individual rate file.
1. From the `transparencyPageUrl` (or a web search `"<brand> transparency in coverage machine readable index"`),
   find the index/TOC link. Common shapes: a direct S3 URL (Anthem: `…s3.amazonaws.com/…/index.json.gz`),
   a dated file (UHC: `…/2026-07-01_<employer>_index.json`), or a "Table of Contents" download.
2. Put it in `issuers.seed.json` as `indexUrl`, and record **where you found it** in that entry's `notes`
   (provenance for the URL itself — same doctrine we apply to coverage data).
3. Gotchas to expect and record rather than fight:
   - Some carriers gate the index behind a search box or an employer/EIN selector — if there's no single
     public index URL, leave `null` and note `"index gated behind <what>"`.
   - Some serve a top-level "blob" index that points at hundreds of per-employer sub-indexes — record the
     top-level one; note it's a nested index (a later chunk crawls it).
   - `anthem` and `cigna` and `mmoh` we already have local pilot files for — if you can find their live
     index, resolve it; if not, note `"live index unresolved; pilot used local file"` and move on.
   - Kaiser is a closed-HMO model — its file may be small/atypical; record whatever it is honestly.

## Run + commit
After editing the seed, re-run over the **full** registry so unresolved rows still emit honest lines:
```
tsx issuer-registry.ts --in issuers.seed.json --out issuers.resolved.ndjson --probe-rates --full-count
```
- `--full-count` gives exact `inNetworkFileCount` (this is the number that sizes the build — worth the
  streaming cost). If any single index is so large that `--full-count` runs long, drop to default count for
  that run and note it; do **not** buffer the file to force a count.
- `--probe-rates` tags each resolved issuer **v1 (references)** vs **v2 (inline, mandatory Feb 2026)** — the
  other build-sizing input.
- Commit the updated `issuers.seed.json` + the freshly-run `issuers.resolved.ndjson`.

## Acceptance
- `issuers.seed.json`: ≥10 of the 12 target keys have a real `indexUrl` + a `notes` provenance string.
- `issuers.resolved.ndjson`: re-run so the resolved issuers show real `reachable`, `httpStatus`,
  `inNetworkFileCount`, `rateSchema`; unresolved ones remain honest `"unresolved"` lines. (This file is a
  **live snapshot committed as data** — counts drift monthly, so it is NOT asserted byte-exact in tests.)
- `DATA.md`: a short table — issuer → index URL → in-network file count → v1/v2 → note. This is the
  human-readable national picture; it's what we'll read to decide the nationwide build.
- `npm test` stays green (the byte-exact fixture test uses local fixtures and is unaffected).

## Explicitly out of scope
No downloading of rate files beyond the 1 MB `--probe-rates` sniff. No extraction, no DB, no infra. Just
resolve + validate + record. The fan-out extraction plan is a later, separate spec.
