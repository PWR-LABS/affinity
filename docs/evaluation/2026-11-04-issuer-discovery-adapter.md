# Issuer discovery adapter handoff — November 4, 2026

`scripts/lib/issuer-discovery.ts` exports `discoverIssuer(issuer, archiveDir, options?, fourthOptions?)`. The original two-argument API is unchanged. Either optional options object accepts the Mini's **synchronous** `{ guard: () => void }`. Root imports are extensionless; only Node built-ins are required.

The caller must provision `archiveDir` on its verified device first. Discovery never creates that root or any parent. It checks the guard before creating its unique run directory, before every archive/manifest write, and during response streaming. A guard failure stops discovery; if the device is gone, a final manifest cannot be written and no replacement root is created.

Successful results contain the requested `tocPath`, `tocUrl`, `sourceDate`, `candidates: [{url, stableKey}]` and `scope`. **Do not log the result object**: signed URLs are returned for exact TOC mapping and download use. `manifest.json` beside the returned TOC contains redacted paths, URL hashes, source/derived hashes, selection, unresolved networks and completion status. Original downloaded bodies are retained at mode 0600, including issuer-published access links inside the original metadata. They belong in the protected public-source archive, outside Git, and contain no application credentials.

Default caps: 30 seconds/request, 120 seconds/run, 2 MB/page or resolver, 10 MB/TOC collection, 20 MB total downloads, 100 MB decoded TOC, 32 ZIP entries and 10,000 distinct TOC paths. Only known metadata hosts and paths may be fetched; redirects to rate paths are rejected. ZIP extraction validates directory/local headers, bounds, names, duplicate entries, encoding, decoded length and CRC. It never uses member names as filesystem destinations. Original ZIP bytes and losslessly recompressed primary TOC have separate hashes and explicit lineage. Dates must be real, not future-dated, and within 60 days.

## Supported discovery and explicit gaps

- **Medical Mutual:** verifies the official transparency-page `/mrf` link and current issuer/brand redirect. The HealthSparq UI currently redirects to itself, so this adapter probes the documented current-month MMO namespace and validates the returned TOC's actual entity/date. It records this method; it does not invent freshness from the clock or fall back to an older month. All mapped in-network URLs, including external dependencies, are returned. Date or portal-identity mismatch fails closed.
- **Cigna:** verifies the official page's latest resolver, downloads its current bounded ZIP, validates/extracts the primary TOC and emits deterministic gzip. Selects exact current paths for the 16 historical network names. Missing names are explicit in both `scope` and `manifest.unresolved`; status is `partial`. This is a selected primary-TOC inventory, not all Cigna networks.
- **Anthem:** verifies the official page/script, status-bucket choice and monthly TOC HEAD response. Throws `IssuerDiscoveryError` with `code: "blocked_large_toc"` and `manifestPath`. That receipt records size and required full streaming mapping work; `sourceDate` remains null because no TOC body was read. EIN samples are never promoted to canonical plan mappings.

Stable keys exclude known transport signatures. Other query parameters are hashed into identity so different source selections cannot silently collapse. Medical Mutual's known date path components are normalized; external naming changes may still yield a new identity and require runner/content reconciliation.

## Verification

Node 24.22.1: **176 tests passed**, including 16 new discovery regressions; root typecheck passed. Tests cover provenance, unresolved selection, deterministic gzip, semantic query identity, corrupt/unsafe ZIPs, byte/time limits including stalled cancellation, false response lengths, unsupported encodings, hostile redirects, mapping/date failures, official fallback, and guard loss during streaming without phantom directories.

Final live metadata run started November 4 at 21:34 UTC:

| Issuer | Result | Metadata bytes downloaded |
| --- | --- | ---: |
| Medical Mutual | November 1 TOC; 50 mapped in-network URLs, including external files | 1,380,313 |
| Cigna | November 1 TOC; 14/16 requested networks; Metro NY Seamless HMO and Tampa IPA Mixed HMO unresolved | 5,399,895 |
| Anthem | Typed block; official TOC HEAD reports 11,517,571,151 bytes | No TOC body downloaded |

No rate/reference files, production data, credentials, paid resources, merge or deployment were changed. Application build/readiness gates were not rerun: this isolated metadata helper changes no runtime app path. Mini retains source acceptance, strict reference validation, storage guard/recovery, retention, scheduler and publication integration. The next step is to integrate this helper and run the guarded source-preparation path; discovery success alone is not a completed refresh. Keeper doctrine/Notion sync is not applicable to this code-only helper slice.
