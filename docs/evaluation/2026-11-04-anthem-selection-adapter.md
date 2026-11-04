# Four-EIN Anthem selection adapter — November 4, 2026

Export: `discoverAnthemSelection(archiveDir, {guard?})` from `scripts/lib/anthem-selection.ts`. The synchronous guard and existing-root requirement match the discovery/selection tools. No parent directory is created.

Return contract:

```ts
{
  directory, selectedPath, selectionPath, receiptPath, selectedCount, tocUrl,
  sourceMonth, sourceDate, sourceDates, tocSourceDate: null, unresolvedEins, scope
}
```

`selectedPath` is a JSON string-array ready for `buildSelectedToc({selected: selectedPath, ...})`. `selectionPath` is the same path for compatibility. `tocUrl` comes from the existing official page/script/status/HEAD resolver. `sourceDate` is the common actual EIN-document update date, or null when those dates differ; `sourceDates` lists them all. It is **not the TOC's source date**: `tocSourceDate` stays null until the complete archived TOC is validated.

The adapter reuses `createIssuerDiscoverer('anthem')` and its provenance archive, then reads only the four official current-bucket EIN documents: 310345740, 340451060, 311188630 and 061553489. It selects only the “In-Network Negotiated Rates Files” URLs. Allowed-amount/out-of-area categories are counted but excluded. No reporting plans are synthesized. Current-month document dates, HTTPS reference shape and known Anthem S3/BCBS host conventions are checked. A new host or malformed document fails explicitly rather than silently dropping URLs.

Default caps: 1 MB per EIN document, 4 MB across them, 2,000 in-network references per document, 400 deduplicated candidates, 1 MB output selection JSON, 30 seconds/request and 180 seconds for the outer run. Known CloudFront/AWS signature fields are ignored only for identity matching; semantic query text and ordering, dates, hosts and shards remain significant. The selected file retains an actual signed URL from an observed source. Never log its contents.

A unique hidden run directory retains original source bodies at mode 0600 plus their hashes. The receipt binds the official resolver manifest/hash, each employer document/hash/date, category counts, selection-file hash, identity/URL hashes and contributing EINs. Success atomically publishes the run directory. Failures retain a protected failed receipt where the guard permits; permanent device loss never recreates a root or writes onto an unverified device. Empty current inventories remain explicitly unresolved, not proof of retirement.

Live metadata verification found **297 selected URLs**, all four documents dated **November 1, 2026**, with **1,427,212 EIN-metadata bytes** and a **126,528-byte selection file**. The TOC was checked with HEAD only; no rate file or full TOC was downloaded on Air. This is selection from four employer inventories, not a national or complete-plan inventory.

Eight offline regression cases and all **184 root tests** passed on Node 24.22.1; root typecheck passed. They cover provenance, signature versus semantic-query identity, explicit empty inventories, date/shape/host rejection, byte/count caps, HTTP/redirect failure, deadlines and device loss. The selected-TOC builder separately passed its 13 tests and bounded-memory fixture in commit `142fbdabba17bfd94dd4d74dc233e76d60bb8c66`. Mini owns real-archive mapping acceptance, its later source-name/employer-ID scope corrections, the runner and production publication; those files were not edited by this adapter slice.
