# Anthem and Cigna refresh inventory — November 4, 2026

Discovery is complete for this bounded slice. No rate file was downloaded in full, no publication was prepared, and no production data, resource configuration, merge or deployment changed. Source observations were made November 4, approximately 21:00–21:06 UTC, against application source `2de10820ae46764731b03bea27a2305d0616d2f4`. Mini retains processing, scheduling, integration and publication ownership.

The [source observations](2026-11-04-employer-source-discovery.json) contain official endpoint provenance, dated HEAD/range receipts, exact byte counts, TOC member hashes and candidate paths. The [existing indexed scope](2026-11-04-employer-indexed-scope.json) is a read-only production inventory. Query strings are omitted from these artifacts: signed paths identify objects but are **not usable download URLs**. Rediscover the actual signed URLs from the official entrypoints.

## Existing scope and the size finding

Production held 241 Anthem files, all on `anthembcbsoh.mrf.bcbs.com`, and 16 Cigna files. Anthem files have plan links; **all 16 Cigna files have zero plan links**. Refreshing Cigna memberships alone cannot make those files searchable or joinable in the current checker. Current TOC mappings must be loaded too. The Medical Mutual refresh belongs to Mini and is outside this inventory.

| Observed inventory | Compressed bytes | Interpretation |
| --- | ---: | --- |
| Anthem full November TOC | 11,517,571,151 | HEAD plus a 256 KiB prefix only; full contents and counts uninspected |
| Anthem four employer lookups, deduplicated in-network URLs | 94,847,702,444 | 297 candidate URLs, all HEAD 200; not a certified replacement set or national inventory |
| Cigna November TOC ZIP collection | 5,270,240 | Five TOC members; bounded metadata ranges inspected |
| Cigna 14 current paths corresponding to old network names | 441,741,591 | 14 HEAD 200 responses; two old names remain unresolved |

These are source transfer sizes, **not database sizes or a Render bill forecast**. New membership counts, deduplication, serving-index growth and refresh peak space require actual Mini extraction measurements. No throughput, compute price or row-footprint extrapolation was performed.

## Anthem official discovery

The [official search page](https://www.anthem.com/machine-readable-file/search/) loads [script.js](https://www.anthem.com/machine-readable-file/search/script.js). That script checks the east1 bucket's [status.json](https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/status.json), selects an east2 fallback on the documented HTTP failure cases, and constructs the monthly TOC URL. East1 returned 200 with `status: "true"`. The [November TOC](https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/2026-11-01_anthem_index.json.gz) returned HEAD 200; its sampled decoded header reports `Anthem Inc`, `last_updated_on: 2026-11-01`, version `2.0.0`. Do not assume the next calendar-month URL exists before checking it.

The official script also resolves `anthem/<nine-digit-EIN>.json`. Four existing indexed employers were sampled:

| Public EIN | Official metadata | In-network URLs | Other categories, counted separately |
| --- | --- | ---: | --- |
| 310345740 | [Kroger lookup](https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/310345740.json) | 295 | 1 allowed-amount file; 550 out-of-area files |
| 340451060 | [Parker Hannifin lookup](https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/340451060.json) | 268 | 1 allowed-amount file; 515 out-of-area files |
| 311188630 | [Cintas lookup](https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/311188630.json) | 237 | 1 allowed-amount file; 401 out-of-area files |
| 061553489 | [Advanced Drainage Systems lookup](https://antm-pt-prod-dataz-nogbd-nophi-us-east1.s3.amazonaws.com/anthem/061553489.json) | 137 | 1 allowed-amount file; 238 out-of-area files |

All four metadata documents report `lastupdated: 2026-11-01`. In the old database, Kroger links to 240 of the 241 Anthem files; the remaining old file links to Advanced Drainage Systems. That explains sample selection, **not equivalence between July and November networks**. Parker Hannifin and Cintas provide overlapping checks. The union is 297 in-network URLs: 247 on the Ohio host totaling 70,604,372,123 bytes, and 50 on S3 totaling 24,243,330,321 bytes. Out-of-area and allowed-amount categories were not added to that sum. They remain uninspected dependencies rather than evidence of complete plan coverage.

Of the 297 candidates, 246 exceed the publisher's 25,000,000-byte source limit; 51 meet only that size gate. The largest is 4,318,902,495 bytes. Six sampled Ohio-host rate prefixes and two small S3 prefixes show November 1 source dates and inline provider groups. The Ohio host serves files whose own metadata names California, Colorado, Indiana and Nevada: **hostname is not a geographic coverage contract**. Shard names/counts and network identifiers differ from July; substituting month strings or retaining old plan names is insufficient.

The small EIN documents list file URLs and display names, not the canonical `reporting_structure[].reporting_plans` objects required by `tocPlans()`. Passing them as a TOC fails the current publisher's mapping requirement. A future adapter would need a separately verified mapping contract; do not manufacture an apparently complete TOC from these samples.

## Cigna official discovery

The [official page](https://www.cigna.com/legal/compliance/machine-readable-files) contains `data-mrf-lookup-url="/static/mrf/latest.json"`. The [resolver](https://www.cigna.com/static/mrf/latest.json) returned 200 and advertises `2026-11-01_cigna-partners-toc-collection.zip`, source date November 1. Its observed signed collection URL expires December 14, 2026 at 14:25:41 UTC. Resolve it on every run rather than pinning the July registry link or guessing a new signature.

The ZIP directory lists the primary Cigna TOC plus Health Partners, MVP, Priority Health and Sagamore TOCs. All five were inspected as metadata. The primary TOC is 2,907,703 bytes compressed and 44,072,313 bytes decoded, version `2.0.1`, dated November 1. It contains 25,931 reporting structures, 28,122 in-network file occurrences and 121 unique paths after removing signed query strings. These counts describe that member, not national Cigna coverage.

Fourteen old network paths have corresponding November paths in the primary TOC. The table uses the exact four-field plan tuples retained by the current publisher, after deduplication; these are file links, not independently verified whole-plan networks.

| Network name in path | Compressed bytes | Publisher plan tuples | Source-size gate |
| --- | ---: | ---: | --- |
| Chicago IL Connect | 13,209,646 | 17 | within limit |
| Cigna managed-care HMO of NH | 13,674,976 | 2 | within limit |
| Florida Connect | 84,627,994 | 34 | over limit |
| Houston Flexcare | 12,973,763 | 1 | within limit |
| Indianapolis HMO | 15,043,650 | 21 | within limit |
| Metro New York GPPO | 131,599,783 | 30 | over limit |
| NC Connect HMO Rural | 106,466,881 | 20 | over limit |
| North New Jersey HMO | 11,013,023 | 1 | within limit |
| Orlando IPA HMO | 11,983,310 | 1 | within limit |
| Pittsburgh GPPO | 9,479,723 | 20 | within limit |
| San Antonio Commercial | 1,398,993 | 1 | within limit |
| South Carolina | 16,158,616 | 3 | within limit |
| St Louis HMO | 12,521,078 | 13 | within limit |
| Wichita GPPO | 1,590,155 | 16 | within limit |

All 14 bounded prefixes report November 1, version `2.0.1`, and inline provider groups. The old `metro-ny-seamless-hmo-network` and `tampa-ipa-mixed-hmo` paths were not found under those names in any of the five current members. They remain **unresolved**, not proven retired, renamed or replaced. For example, a current Central Florida Seamless path is not evidence that it replaces Tampa.

## Publisher and scheduler handoff

1. **Start with one small mapped Cigna candidate on Mini.** San Antonio Commercial or Wichita GPPO fits the source-size gate. Archive the current official ZIP, preserve its member hash and exact signed source link, then extract and validate the full selected rate file. Use the existing disposable-database publication evaluation before any separately authorized production publication. Size and prefix inspection do not prove the 200,000-membership gate will pass.
2. **Normalize containers without losing provenance.** The current publisher accepts JSON/gzip TOCs, not ZIP. Raw primary Cigna JSON exceeds its 10 MB compressed-input gate. Lossless deterministic gzip measured 2,887,722 bytes and round-tripped to the same 44,072,313-byte member, within the 100 MB decoded gate. Keep the original ZIP, member name/hash and gzip hash in the SSD manifest; a recompressed TOC is a derived archive, not the original downloaded bytes.
3. **Handle Anthem with a validated large-TOC path.** Its 11.52 GB TOC cannot enter the current bounded reader. Preserve the upstream archive and stream a deliberately scoped selection with evidence linking selected mappings to that archive. The existing `toc-manifest.ts` tokenizes the input but retains selected rows/sets and sorts them in memory; token streaming alone does not establish bounded memory for this full catalog. A partial manifest must remain labeled partial.
4. **Prove reference closure before publishing.** No external `location` was observed in sampled rate prefixes, but the rest of each file is uninspected. Full reference-file dependencies therefore remain unknown. The extractor currently fetches remote provider references during its first pass and can skip unresolved IDs; `prepare` rejects reported remote fetches only after extraction. Unattended work needs archived reference hashes, explicit byte/concurrency limits and unresolved-reference rejection before those files can be accepted. Do not disable the rejection or treat a prefix with inline groups as proof of closure.
5. **Keep resource and publication limits explicit.** Preserve the 25 MB source, 10 MB compressed/100 MB decoded TOC, 200,000-membership and 30,000-plan-link limits until an independently tested expansion exists. A file-date change, HTTP ETag or scheduled check is not a successful refresh. Signed-URL churn can create new URL identities for the same object, so deduplication/checkpointing must account for stable object identity and verified content. The existing runner's size-based tiers, URL-derived done markers and default minimum-plan filter do not certify that every requested source was refreshed. Retention, rollback, new generation activation and complete-plan certification remain Mini integration work; no negative coverage answer is enabled by this discovery.

## Verification and delivery limits

All 297 Anthem candidate and 14 Cigna candidate HEAD requests returned 200. GETs were restricted to small official pages, JSON metadata, ZIP metadata/member ranges and 64 KiB rate prefixes (256 KiB for the Anthem TOC prefix). Range requests required HTTP 206 and explicit read/decode caps; SHA-256 receipts distinguish prefixes from complete files. Cigna partner TOCs add no match for the two unresolved old names. Numeric summaries and inventory cross-references were checked locally; no application code changed, so the app test/build suite was not rerun.

The older Air checkout and its untracked Medicare sweep were preserved. This new discovery branch is a reviewable Git handoff, not a refreshed database or automatic updater. Notion sync is not applicable: no keeper-owned doctrine or managed Notion content changed. No temporary GUI surfaces were opened. The next executable step belongs to Mini: prepare and measure one current mapped Cigna source, keeping full-refresh capacity and coverage claims unknown until the remaining inventory is accepted.
