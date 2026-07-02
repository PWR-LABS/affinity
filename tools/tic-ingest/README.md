# affinity — TiC ingest handoff (Codex work package)

Three **bounded, standalone tools** for the Transparency-in-Coverage (TiC) commercial pilot.
Each SPEC file is self-contained — paste one spec per Codex task. No product context needed beyond it.

**Stack (all three):** TypeScript, Node 20+, run via `tsx`. Only allowed deps: `stream-json` (streaming
JSON), Node built-ins (`zlib`, `stream`, `fs`, `readline`). No frameworks, no DB clients — output is
NDJSON/CSV files. Constant-memory streaming is a hard requirement (input files reach 1–100+ GB).

**Where the code lands:** right here — `tools/tic-ingest/` in the affinity repo. Add a local
`package.json` in this dir, one CLI per tool, and tests (self-contained; do not touch the Next.js app or
the repo-root `package.json`). Run everything from this dir — fixture paths in `fixtures/README.md`
assume it.

| Tool | Spec | Input | Output |
| --- | --- | --- | --- |
| `toc-manifest` | SPEC-1 | issuer table-of-contents JSON (URL or path, may be .gz) | `manifest.csv` of in-network files + plan mapping |
| `tic-extract` | SPEC-2 | one in-network rate file (URL or path, .json or .json.gz) | `providers.ndjson` of (npi, tin, file) tuples |
| `nppes-allowlist` | SPEC-3 | NPPES full-replacement CSV + state/CBSA filter | `allowlist.txt` of NPIs |

**Shared conventions**
- CLI: `--in <url|path>` `--out <path>`; non-zero exit on fatal error; progress line to stderr every 10s
  (`rows=… npis=… mb=…`).
- HTTP: stream the response body (no buffering to memory/disk unless `--tmp` given); follow redirects;
  retry 3× with backoff on 5xx/network errors; a 404 is a **recorded skip, not a crash**.
- Gzip: sniff magic bytes (`1f 8b`) rather than trusting the extension.
- Determinism: same input ⇒ byte-identical output (sort/dedup before write where specified).

**Acceptance:** each spec has fixtures + exact expected outputs (in `fixtures/`) and a memory ceiling
test. All must pass via `npm test` in the tool dir.
