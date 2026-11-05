# Shared issuer plan mappings — 2026-11-05

The remaining reviewed Anthem selection repeats identical employer-plan metadata across many files. Keeping a separate copy for each file consumes cloud space without adding evidence. The shared representation preserves the exact mapping and source-file associations within the existing 2.5 GB publishing gate and 5 GB allocated database.

## Measurement

At 09:10:32Z, 125 of 297 selected Anthem files were current. The 172 pending files contained 690,815 deduplicated per-file plan records (52,206,913 canonical metadata bytes). Complete comparison of their archived TOC projections at 09:30:01Z found 14 distinct sets containing 36,902 records (2,791,519 canonical bytes). These are metadata measurements, not PostgreSQL allocated-size or invoice savings. The protected local receipt is `finish-issuer-refresh/plan-reuse-measurement.json` on the approved SSD.

## Contract

- Immutable set identity includes every plan name, identifier type, identifier and market field, using length-prefixed UTF-8 fields, binary ordering, per-row hashes and a version domain. Invalid or lossy text and duplicate metadata fail closed.
- Initial publication and replay compute a separate digest of the actual stored fields inside PostgreSQL. Equal row counts cannot hide changed content. Routine verification returns only a digest and counts to Mini.
- Each file points to its exact set. Existing per-file plan rows remain unchanged; public search and provider checks support both representations, active generations and source freshness. Absence remains unknown.
- New sets reserve their full plan estimate. Reusing a verified set reserves a new file association. Both preflight and the transaction retain the 2.5 GB gate; no Render allocation, disk autoscaling, job or replica changes occur.
- The guarded existing web startup adds three tables and restricted publisher grants. Mini requires separate owner-only opt-in plus a live reader capability check before producing shared mappings.
- Retirement may remove only an orphaned set nominated by the archive-verified retired file. Other current and rollback associations protect shared sets. Reader rollback must preserve shared mapping support or first withdraw incompatible generations.

## Verification

254 application tests passed, along with TypeScript and the production build. Targeted identity tests cover order, all fields, ambiguous concatenation, Unicode normalization distinctions, duplicate metadata and lossy text. Six real disposable PostgreSQL checks passed: exact shared publication/replay and lookup; changed-content rejection at equal count; interrupted-write rollback; legacy compatibility and stale evidence; retention and withdrawal; and a two-batch 2,000-plan SQL digest with unordered reuse and an equal-count ordinal gap. The five existing compact publication/recovery checks also passed.

This is implementation and local verification evidence. Deployment, Mini installation and live canary acceptance require separate receipts. The ongoing full issuer refresh is not declared complete by this report.
