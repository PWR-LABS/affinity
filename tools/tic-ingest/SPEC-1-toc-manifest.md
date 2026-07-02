# SPEC-1 — `toc-manifest`: TiC table-of-contents → file manifest

Build a TypeScript CLI (`tsx toc-manifest.ts`) that streams a Transparency-in-Coverage
**table-of-contents** JSON (per the CMS price-transparency-guide `table-of-contents` schema) and emits a
CSV manifest of the in-network files it references, joined to the plans they report for.

## Input
- `--in <url|path>` — the TOC JSON (may be `.json.gz`; may be several GB for big issuers → **must stream**,
  never `JSON.parse` the whole document).
- Optional filters (AND-ed):
  - `--plan-regex <re>` — case-insensitive regex against `plan_name`.
  - `--state <XX>` — keep rows whose plan_name OR file description/location contains the state token
    (match `-XX-`, `_XX_`, ` XX `, case-insensitive; crude is fine, it's a pre-filter).
  - `--max-files <n>` — stop after n distinct files (for sampling).

## TOC shape (CMS schema, v2.x)
Top level: `reporting_entity_name`, `reporting_entity_type`, `reporting_structure[]`.
Each `reporting_structure` item:
- `reporting_plans[]`: `{ plan_name, plan_id_type ("EIN"|"HIOS"), plan_id, plan_market_type ("group"|"individual") }`
- `in_network_files[]`: `{ description, location }` (location = URL)
- optional `allowed_amount_file` (ignore).

Tolerate real-world sloppiness: missing optional fields, `in_network_files` absent (skip the structure),
duplicate file locations across structures (that's the join — one file serves many plans).

## Output — `manifest.csv`
One row per **(file_url, plan)** pair, header:

```
file_url,file_description,plan_name,plan_id_type,plan_id,plan_market_type,reporting_entity
```

- CSV-escape properly (quotes, commas, newlines in plan names happen).
- Sort by `file_url` then `plan_id`; dedup exact rows.
- Also emit `manifest.files.csv`: one row per distinct file — `file_url,file_description,plan_count`
  plus, when `--head` is passed, `content_length_bytes` from an HTTP HEAD (tolerate HEAD failures → empty).
- Stderr summary at end: structures seen, distinct files, distinct plans, rows written.

## Acceptance
- `fixtures/toc-sample.json` → byte-identical `fixtures/expected-manifest.csv` (build the fixture from the
  CMS schema example shapes; ≥2 reporting_structures, one shared file across both, one structure with no
  in_network_files, one plan_name containing a comma).
- A generated ~200 MB TOC (repeat the fixture's structures 200k×, script it in the test) processes with
  `node --max-old-space-size=128` without OOM.
- 404 on `--head`: row still written, size empty, exit 0.
