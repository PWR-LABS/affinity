# Bounded employer source refresh

The web app accepts recent issuer-file listings, not proof of complete plan coverage. The old `tic:load` importer deletes existing rows before replacement finishes; do not use it for unattended production refreshes.

`scripts/tic-refresh.ts` prepares, validates, and publishes one selected issuer file. It does not select nationwide coverage, certify negative answers, schedule itself, or replace Medicare data.

1. Resolve the issuer's current table of contents through its official transparency site. Archive the TOC and selected rate file locally; record URLs, observed source dates, and download receipts in the storage manifest. Keep large files outside Git and the web service. Check the intended mounted volume, capacity, and free-space floor before downloads.
2. Install the locked extraction tools with `npm ci --prefix tools/tic-ingest`. Run `node --import tsx scripts/tic-refresh.ts --action prepare --source <local-rate-file> --source-url <original-https-url> --toc <local-toc> --toc-url <original-https-toc-url> --out <local-publication-directory>` using the repository's Node version.
3. Preparation verifies that the source URL appears in the archived TOC, preserves its plan mappings, extracts memberships without an NPI allowlist, and emits a hashed `publication.json`. Limits: 25 MB source archive, 10 MB compressed/100 MB decoded TOC, 200,000 memberships and 30,000 plan links. Files requiring external provider references are rejected until those references can also be archived and verified. This is intentionally a bounded publisher, not the national streaming pipeline.
4. Validate with `--action validate --receipt <publication.json>`. Test the real candidate against a disposable loopback database using `scripts/eval-tic-publication.ts` and `AFFINITY_TIC_PUBLICATION=<publication.json>`. That evaluator requires the dedicated database `affinity_employer_e2e`; it deletes only synthetic test records there.
5. For an authorized production publication, supply `DATABASE_URL` securely and run `--action publish --receipt <publication.json> --expected-host <exact-database-host> --result <protected-local-result.json>`. External connections require `sslmode=require`. Never place credentials in arguments, screenshots, receipts, Git, or the public-data SSD workspace.
6. Check the committed file ID, actual database counts, dated positive source listing, unknown missing-provider result, plan search and public page. Remove the temporary connection bridge and close temporary access surfaces.

## Publication and recovery contract

Raw source, TOC, and membership SHA-256 hashes are checked before publication. Every row must share the selected source URL, date, entity and schema; malformed or mismatched records fail rather than being skipped. The plan mapping must still equal the archived TOC. Duplicate membership keys fail the transaction.

The publisher adds a new file and all its memberships/plan links in **one database transaction**, under an advisory publisher lock. It reads back counts before commit, rechecks membership bytes, and leaves every existing file untouched. A failed batch rolls back the entire new file. An already indexed URL fails closed; replay never replaces data silently. A publication may be valid for one file while its plans remain only partly indexed.

The result records the exact new file ID and source URL. If a committed publication must be withdrawn, first verify both against that result and recheck the intended database. Delete only that newly added file ID in a transaction; its memberships and links cascade. Existing sources are untouched, and the archived, verified candidate can be published again if appropriate. Do not delete older datasets as part of this bounded workflow.

The publisher makes no paid resource changes. Refresh cadence, nationwide selection, source inventory completeness, retirement of old generations, and automated retention are separate work.
