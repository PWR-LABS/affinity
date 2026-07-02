# SPEC-2 — `tic-extract`: in-network rate file → provider↔file NDJSON (rates discarded)

Build a TypeScript CLI (`tsx tic-extract.ts`) that streams ONE Transparency-in-Coverage **in-network
rate** file and extracts **network membership only**: which NPIs appear in this file, under which TIN.
Every negotiated-price/rate value is **discarded** — we never store rates. This is the core ingest tool;
input files range from ~100 MB to >100 GB gzipped, so constant-memory streaming is non-negotiable.

## Input
- `--in <url|path>` — one in-network file (`.json` or `.json.gz`; sniff gzip magic bytes).
- `--allowlist <path>` (optional) — newline-delimited NPIs; when given, emit only matching NPIs
  (load into a `Set`; allowlist ≈ 10k–2M lines, that's fine in memory).
- `--out <path>` — NDJSON output (default `providers.ndjson`).

## Schema reality (support BOTH)
**v2.x (current, mandatory since Feb 2026)** — provider groups are inline:
```
in_network[].negotiated_rates[].provider_groups[] = { npi: number[], tin: { type: "ein"|"npi", value: string } }
```
**v1.x (legacy fallback, some issuers lag)** — indirection via references:
- Root-level `provider_references[] = { provider_group_id, provider_groups[] (same shape), OR location (remote URL) }`
- `in_network[].negotiated_rates[].provider_references[] = provider_group_id`

Detection: if a root `provider_references` array is encountered → v1 mode; else v2. In v1 mode, collect
`provider_group_id → provider_groups` while streaming (root refs precede or follow `in_network` — handle
both orders: buffer only the *reference table* (ids + npi/tin lists, no rates), never the in_network array;
if refs come after, do a second pass over the file — acceptable, document it). For a v1 **remote** reference
(`location` URL instead of inline groups): fetch it (stream, small files), tolerate 404 by recording a skip.

## Extraction rules
For every provider_group reached (v2 inline, or v1 via reference):
- Each element of `npi[]` → one tuple with the group's `tin`.
- **Drop NPI 0** (the schema's explicit "no NPI" sentinel) and anything not a 10-digit number.
- **Anthem quirk:** some issuers put the TIN value into the NPI array. Drop any 9-digit "NPI" (EINs are
  9 digits), and drop an NPI equal to `tin.value` **only when `tin.type === "ein"`** (when `tin.type` is
  `"npi"`, a solo provider's TIN legitimately equals their NPI — keep it). Count drops in the summary as
  `tin_in_npi_dropped`.
- Ignore `negotiated_prices`, `billing_code*`, service codes, rates — skip those subtrees entirely in the
  stream (do not materialize them).

## Output — NDJSON, one line per distinct (npi, tin_value) pair
```json
{"npi":"1234567893","tin_type":"ein","tin_value":"123456789","file_url":"<--in value>","reporting_entity":"...","last_updated_on":"YYYY-MM-DD","schema":"v2"}
```
- `reporting_entity` + `last_updated_on` + `version` come from the file's top-level fields (stream-capture
  them whenever they appear).
- Dedup on (npi, tin_value) with an in-memory `Set` of `npi|tin` strings. A worst-case national file has
  ~2–6 M distinct pairs → a Set of short strings is fine (<1 GB); if `--allowlist` is set the Set is tiny.
  Sort output lines lexicographically before final write (write to temp NDJSON, then sort — use an
  external-merge or `sort(1)` via child_process if >2 GB temp; document choice).
- Stderr summary JSON at end: `{files:1, npis_emitted, pairs_emitted, zero_npi_dropped, tin_in_npi_dropped, remote_refs_fetched, remote_refs_404, schema, seconds, peak_rss_mb}`.

## Acceptance (fixtures provided in `fixtures/`)
1. `tic-in-network-v2-sample.json` → exactly `expected-v2.ndjson` (byte-identical after your sort).
2. `tic-in-network-v1-sample.json` (root provider_references BEFORE in_network) → `expected-v1.ndjson`.
3. Same v1 fixture with sections reordered (refs AFTER in_network — generate in test) → same output.
4. Memory: concatenate the v2 fixture's `in_network` entries ~500k× (script it; ~1–2 GB json, gzip it) →
   must complete under `node --max-old-space-size=256` with `--allowlist` of 5 NPIs, and the summary's
   `pairs_emitted` must equal the expected count.
5. `--allowlist` filtering: only allowlisted NPIs appear in output.
6. Gzip + plain both work; URL input works (spin a tiny local http server in the test).
