# SPEC-8 — `issuer-registry`: the national commercial-issuer index registry + validator

Build a TypeScript CLI (`tsx issuer-registry.ts`) in this dir (conventions per `README.md`; extend
`test.ts` without breaking existing tests). This is the **first bounded step toward nationwide commercial
coverage**: turn "which issuers, and where are their Transparency-in-Coverage index files" into a
**checked-in, validated manifest** — no downloading of the multi-TB rate files, no infra decisions. Just:
a curated registry of the top ~35 commercial issuer families, and a tool that confirms each index URL is
live and really is a TiC table-of-contents, recording the metadata we need to plan the build.

## Deliverable 1 — `issuers.seed.json` (checked-in, human-curated seed)
An array of issuer-family entries. **Author it from the seed table at the bottom of this spec.** Shape:
```json
{
  "key": "uhc",
  "legalName": "UnitedHealthcare Insurance Company",
  "brand": "UnitedHealthcare",
  "family": "UnitedHealth Group",
  "footprint": "national",
  "transparencyPageUrl": "https://transparency-in-coverage.uhc.com/",
  "indexUrl": null,
  "haveData": false,
  "notes": "largest commercial carrier"
}
```
- `indexUrl` is the **machine-readable table-of-contents URL** (the JSON index that lists `in_network_files`),
  NOT the human landing page. Seed it `null` where unknown; resolve at runtime (see below) and commit the
  filled-in value.
- `footprint`: `"national"` or an array of USPS state codes for regional carriers.
- `haveData: true` for the three we already piloted (Medical Mutual of Ohio, Anthem, Cigna) — the tool must
  still validate them.

## Deliverable 2 — `issuer-registry.ts` (the validator)
`tsx issuer-registry.ts --in issuers.seed.json --out issuers.resolved.ndjson [--probe-rates] [--full-count]`

For each entry **that has an `indexUrl`**, validate WITHOUT buffering the whole file (TiC index files reach
10 GB — the Anthem TOC is ~10.5 GB / 888K in-network entries). Two cheap modes:
- **Default (streaming validate):** GET the index and **stream-parse** it (reuse the constant-memory TOC
  parse from `toc-manifest.ts`, SPEC-1 — do not re-buffer). Confirm it is a TiC TOC: top level has
  `reporting_entity_name` + `reporting_structure[]`, and at least one `in_network_files[].location`.
  Record `reportingEntityName`, `reportingStructures` (count), a running `inNetworkFileCount`, and the
  first 3 `sampleFileLocations`. Stop after the first 3 samples unless `--full-count` is given (then stream
  to EOF for an exact `inNetworkFileCount`; default count is `">=N (partial)"`-flagged — see output).
- **`--head-only` (cheapest):** ranged `GET Range: bytes=0-65535`; confirm `reporting_entity_name` appears
  in the head; record reachability + entity name only (`inNetworkFileCount: null`).
- **`--probe-rates` (optional stretch, sizes the real build):** after validating the index, ranged-GET the
  **first ~1 MB of the first `in_network_files[].location`** and sniff the rate-file schema:
  `provider_references` present ⇒ `"v1"` (references); inline `provider_groups` inside `in_network[]` ⇒
  `"v2"` (inline, mandatory Feb 2026). Record as `rateSchema`. One rate file per issuer, ranged — stays cheap.

**Resolving a `null` `indexUrl`:** entries seeded without an `indexUrl` are **skipped with a recorded
reason** (`"indexUrl unresolved"`) — resolution from the `transparencyPageUrl` is a manual/research step the
operator does before re-running; the tool never scrapes HTML. (If you resolve any by hand while building,
fill them into `issuers.seed.json` and note the source in `notes`.)

## HTTP / robustness (per README shared conventions)
Follow redirects; retry 3× with backoff on 5xx/network error; **a 404 / unreachable host is a recorded
result, not a crash** (`reachable:false`, `httpStatus`, `error`). Sniff gzip by magic bytes (`1f 8b`) —
many indexes are served `.json.gz` regardless of extension. Progress line to stderr every 10s.

## Output — `issuers.resolved.ndjson` (one line per registry entry, sorted by `key`, deterministic)
```json
{"key":"uhc","indexUrl":"https://...","reachable":true,"httpStatus":200,"contentLength":52428800,"gzip":true,"reportingEntityName":"UnitedHealthcare","reportingStructures":1,"inNetworkFileCount":1234,"countExact":false,"sampleFileLocations":["https://...","https://...","https://..."],"rateSchema":"v2","error":null}
```
- **No timestamps in the output** (determinism — same fixtures ⇒ byte-identical). Timing/summary go to
  stderr as JSON: `{entries, validated, reachable, unresolved, seconds}`.
- `contentLength` from the `Content-Length` header when present, else `null`. `countExact:false` unless
  `--full-count` streamed the whole index. `rateSchema` only present with `--probe-rates`, else omit key.
- Unresolved/unreachable entries still emit a line (`reachable:false`, `error:"indexUrl unresolved"` etc.)
  so the file is a complete national picture, gaps included — same doctrine as the rest of affinity:
  **an unknown is recorded honestly, never dropped.**

## Acceptance
- **Offline, deterministic tests** (no live network in `npm test`): the tool must accept a **local file path
  or `file://` URL** as `indexUrl` and validate it by reading the file — same code path as HTTP minus the
  fetch. Build synthetic fixtures:
  - `fixtures/issuer-index-v2.json` — a minimal TiC TOC: `reporting_entity_name`, one `reporting_structure`
    with 3 `in_network_files` (local `file://` locations), one of which points at
    `fixtures/rate-inline-v2.json` (inline `provider_groups`).
  - `fixtures/issuer-index-v1.json.gz` — gzipped TOC whose first rate file is `fixtures/rate-refs-v1.json`
    (has `provider_references`). Exercises gzip sniffing + `--probe-rates` v1 detection.
  - `fixtures/issuer-index-notoc.json` — valid JSON but missing `reporting_structure` ⇒ recorded
    `error:"not a TiC index"`, `reachable:true`.
  - `fixtures/issuers-seed-sample.json` — 4 entries: the two valid indexes above (one national, one
    regional with a state-array footprint), the not-a-toc one, and one with `indexUrl:null` (unresolved).
- **Byte-exact** `fixtures/expected-issuers.resolved.ndjson` for a run with `--probe-rates` over the sample
  seed (v2 index ⇒ `rateSchema:"v2"`, `inNetworkFileCount:3`; v1 ⇒ `"v1"`; notoc ⇒ error; null ⇒ unresolved).
- **Memory ceiling:** generate a synthetic 2 GB index (one `reporting_structure`, millions of
  `in_network_files`) and confirm a default `--full-count` run completes under
  `node --max-old-space-size=256` — proves the streaming parse never materializes the file. Document peak RSS.
- All prior tool tests stay green (`npm test`).

---

## Seed registry (author `issuers.seed.json` from this — top ~35 commercial families ≈ 90% of insured lives)
`transparencyPageUrl` is the stable public entry point; `indexUrl` left `null` unless noted (resolve later).
Do **not** invent index URLs — seed the ones below as given, leave the rest `null`.

| key | brand | family | footprint | transparency page (starting point) |
| --- | --- | --- | --- | --- |
| uhc | UnitedHealthcare | UnitedHealth Group | national | transparency-in-coverage.uhc.com |
| anthem | Anthem BCBS | Elevance Health | 14 states | anthem.com/machine-readable-file (haveData) |
| aetna | Aetna | CVS Health | national | aetna.com → "Transparency in coverage" |
| cigna | Cigna Healthcare | The Cigna Group | national | cigna.com/legal/compliance/machine-readable-files (haveData) |
| hcsc | BCBS IL/TX/OK/NM/MT | Health Care Service Corp | 5 states | hcsc.com → transparency |
| kaiser | Kaiser Permanente | Kaiser | 8 states + DC | healthy.kaiserpermanente.org (closed HMO — note network model) |
| centene | Ambetter | Centene | national (exchange) | centene.com → transparency |
| humana | Humana | Humana | national (mostly MA; thin commercial) | humana.com → transparency |
| bcbsmi | Blue Cross Blue Shield of Michigan | BCBSM | MI | bcbsm.com → transparency |
| flblue | Florida Blue | GuideWell | FL | floridablue.com → transparency |
| highmark | Highmark BCBS | Highmark | PA/WV/DE/NY | highmark.com → transparency |
| ibx | Independence Blue Cross | Independence | PA (Philly) | ibx.com → transparency |
| horizon | Horizon BCBS of NJ | Horizon | NJ | horizonblue.com → transparency |
| bcbsnc | Blue Cross NC | BCBSNC | NC | bluecrossnc.com → transparency |
| bcbstn | BlueCross BlueShield of TN | BCBST | TN | bcbst.com → transparency |
| carefirst | CareFirst BCBS | CareFirst | MD/DC/VA | carefirst.com → transparency |
| bcbsma | Blue Cross Blue Shield of MA | BCBSMA | MA | bluecrossma.org → transparency |
| premera | Premera Blue Cross | Premera | WA/AK | premera.com → transparency |
| regence | Regence BCBS | Cambia | OR/ID/UT/WA | regence.com → transparency |
| bshca | Blue Shield of California | BSC | CA | blueshieldca.com → transparency |
| bcbsal | Blue Cross Blue Shield of AL | BCBSAL | AL | bcbsal.org → transparency |
| bcbsmn | Blue Cross Blue Shield of MN | BCBSMN | MN | bluecrossmn.com → transparency |
| wellmark | Wellmark BCBS | Wellmark | IA/SD | wellmark.com → transparency |
| bcidaho | Blue Cross of Idaho | BCI | ID | bcidaho.com → transparency |
| molina | Molina Healthcare | Molina | national (Medicaid/exchange) | molinahealthcare.com → transparency |
| oscar | Oscar Health | Oscar | multi-state (exchange) | hioscar.com → transparency |
| mmoh | Medical Mutual of Ohio | MMO | OH | medmutual.com → transparency (haveData) |
| upmc | UPMC Health Plan | UPMC | PA | upmchealthplan.com → transparency |
| providence | Providence Health Plan | Providence | OR/WA | providencehealthplan.com → transparency |
| emblem | EmblemHealth | Emblem | NY | emblemhealth.com → transparency |
| point32 | Harvard Pilgrim / Tufts | Point32Health | New England | point32health.org → transparency |
| healthnet | Health Net | Centene | CA | healthnet.com → transparency |
| selecthealth | SelectHealth | Intermountain | UT/ID/NV/CO | selecthealth.org → transparency |
| geisinger | Geisinger Health Plan | Geisinger | PA | geisinger.org → transparency |
| sanford | Sanford Health Plan | Sanford | ND/SD/IA/MN | sanfordhealthplan.com → transparency |

> Coverage logic: the four nationals (UHC, Aetna, Cigna, + Elevance/Anthem's 14 states) plus HCSC and the
> independent Blues that own their home states get you to ~90% of commercially-insured lives. The tail
> (provider-sponsored + regional HMOs) is the last ~10% and is where per-issuer effort stops scaling.
