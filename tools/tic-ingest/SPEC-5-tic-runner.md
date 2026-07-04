# SPEC-5 — `tic-runner`: orchestrate manifest → tiered extraction across an issuer

Productize the ad-hoc bash runners in TypeScript (`tsx tic-runner.ts`), same conventions as prior specs
(this dir, stream-json + built-ins, extend `test.ts` without breaking the 11 existing tests).

## Behavior
`tsx tic-runner.ts --manifest <manifest.files.csv> --out-dir <dir> [--allowlist <path>] [--max-bytes 314572800] [--min-plans 10] [--domain-filter <substr>] [--passes 3] [--concurrency 2]`

1. Read `manifest.files.csv` (cols: `file_url,file_description,plan_count[,content_length_bytes]`).
   If `content_length_bytes` is missing for a row, HEAD the URL (15s timeout; failure → 0).
2. Select candidates: `plan_count >= min-plans`, optional `--domain-filter` substring on the URL,
   split into **tier A** (`0 < bytes <= max-bytes`) and **tier B** (larger) — write both as
   `<out-dir>/tier-a.csv` and `<out-dir>/tier-b.csv` (`bytes,plan_count,url`, tier A sorted by
   plan_count desc, tier B by bytes desc).
3. Run tier A through `tic-extract` (invoke its exported function directly — refactor tic-extract to
   export `runExtract(opts)` and keep its CLI as a thin wrapper; do NOT shell out to npx per file):
   - shard name = URL basename, query string stripped, `.json.gz`/`.gz`/`.json`/`.zip` suffix stripped;
   - skip shards with an existing `<shard>.done` marker (resumable);
   - on success write `<shard>.ndjson` + `<shard>.done` + per-shard stderr summary to `<shard>.log`;
   - on failure delete the partial `.ndjson`, continue; retry failed shards up to `--passes` full passes;
   - `--concurrency N` shards in flight at once (default 2; simple promise pool).
4. Exit 0 if all tier-A shards done; exit 1 otherwise. Final stderr summary JSON:
   `{candidates, tier_a, tier_b, done, failed, pairs_total, seconds}`.

## Acceptance
- Fixture: a small `manifest.files.csv` + two tiny in-network fixture files served by an in-test local
  HTTP server (reuse the pattern from the existing URL test); one server route fails twice then succeeds
  (proves pass-retry); one file exceeds `--max-bytes` (proves tier-B routing). Byte-exact expected
  tier CSVs; `.done` markers verified; re-run skips completed shards (assert no re-fetch via a request
  counter).
- All prior tests green via `npm test`.
