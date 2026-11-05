# Remaining issuer discovery gaps — November 4, 2026

Human intent: resolve the two historical Cigna network names and the Medical Mutual Optum portal reference using current official sources, without inventing network equivalence, downloading rate bodies, changing production, or increasing paid resources. Mini retains integration and acceptance ownership. Air verified remote main `80ddb90a1d57208e98f0f80ad04660aa252e056f` before research; its separate checkout and other checkouts were preserved.

Observation date: November 4, 2026, America/New_York. HTTP receipts and the upstream error below retain their original UTC timestamps, which fall on November 5. Generation or observation time is not a new source update date.

## Result

No adapter correction is justified by the available evidence. Both historical Cigna identities remain unresolved in the current official collection. Optum exposes genuine current file locators, but the inspected Ohio TOC request fails at the issuer-provided signed destination, preventing source-level plan mapping validation. Neither absence nor an access failure establishes retirement, non-coverage, or a replacement relationship.

## Cigna: current collection checked in full

Official discovery chain:

- [Cigna machine-readable-file disclosure page](https://www.cigna.com/legal/compliance/machine-readable-files).
- [Current official resolver](https://www.cigna.com/static/mrf/latest.json), fetched at `2026-11-05T04:35:05.681734+00:00`; it identifies source date `2026-11-01` and the November collection.
- Collection identity, signing query omitted: `https://d25kgz5rikkq4n.cloudfront.net/cost_transparency/mrf/table-of-contents-zip/reporting_month=2026-11/2026-11-01_cigna-partners-toc-collection.zip`.

The complete collection was 5,270,240 bytes, SHA-256 `745c50a8ccd18afed697d6840f661f7857c0489aad7b1c06eeb035a386aa8444`, observed at `2026-11-05T04:35:06.241485+00:00`. All five ZIP members passed CRC and complete JSON parsing. Their total decoded metadata size was 86,377,978 bytes. All five report `last_updated_on: 2026-11-01`.

| TOC member, after the `2026-11-01_` prefix | Decoded bytes | Distinct in-network paths | Member SHA-256 |
| --- | ---: | ---: | --- |
| `cigna-health-life-insurance-company_index.json` | 44,072,313 | 121 | `84699b59715d9356aed17149d17e9d834638c78b4230be201d75b178274a7ecd` |
| `health-partners_index.json` | 11,856,174 | 2 | `30c01030d378781fcb83dd64f2ce1bc6379f06a10186fcdccc4c1c342d8402f9` |
| `mvp_index.json` | 10,985,972 | 1 | `e503ea518ada035c8b8632a716627a2da61c06197e9fcb68384b95bb126142a2` |
| `priority-health_index.json` | 9,797,494 | 1 | `b93c6edfb60b631ed5424fe4f69a1e7b0ef7f242238c919d4e95b4806e8fb07c` |
| `sagamore_index.json` | 9,666,025 | 1 | `f6aec74a74a225d031b0cebc281bb324c0f3317021e30a4cf69b4c5e1c7c7b96` |

Neither exact historical URL slug occurs in any member's in-network locations:

- `metro-ny-seamless-hmo-network`
- `tampa-ipa-mixed-hmo`

The current primary TOC does list other distinct identities, including `metro-new-york-gppo`, `florida-hmo`, `florida-connect`, `central-florida-network-seamless`, and Florida SureFit files. Those names are not evidence that either missing historical network was renamed or absorbed. No issuer-published replacement mapping or retirement notice was located in this bounded review. The partner TOCs contain Health Partners, MVP, Priority Health and Sagamore mappings, not an exact match for either missing slug.

External resolution requires an explicit Cigna mapping/status statement or a current official TOC entry for the exact identity. The existing adapter already preserves this uncertainty; removing the unresolved entries or silently substituting another network would overstate the evidence.

## Medical Mutual: Optum portal and signed-source failure

The current Medical Mutual TOC identity is:

`https://mrf.healthsparq.com/mmo-egress.nophi.kyruushsq.com/prd/mrf/MMO_I/MMO/2026-11-01/tableOfContents/2026-11-01_Medical-Mutual-Of-Ohio_index.json.gz`

It reports source date `2026-11-01`. The archived gzip is 1,162,612 bytes, SHA-256 `3dd59a55e6c9bb5978ae459bc56ec3404b4dba48f8e63affc23fa8ae17252ca3`, observed at `2026-11-05T04:35:06.615136+00:00`. Its `Optum` in-network reference is the generic [Optum disclosure portal](https://transparency-in-coverage.optum.com/), associated with 18,604 source plan objects. A portal URL is not a JSON rate file.

The public portal rendered successfully in the browser. Its November inventory exposed 28 TOCs and 638 in-network file links. Four file names explicitly contain `STATE-OF-OHIO-MMO`:

| File name | Official portal download locator |
| --- | --- |
| `2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-HDHP-FAMILY_in-network-rates.zip` | `https://transparency-in-coverage.optum.com/api/v1/oh/blobs/download/2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-HDHP-FAMILY_in-network-rates.zip` |
| `2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-HDHP-INDIVIDUAL_in-network-rates.zip` | `https://transparency-in-coverage.optum.com/api/v1/oh/blobs/download/2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-HDHP-INDIVIDUAL_in-network-rates.zip` |
| `2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-NN-EPO_in-network-rates.zip` | `https://transparency-in-coverage.optum.com/api/v1/oh/blobs/download/2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-NN-EPO_in-network-rates.zip` |
| `2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-PPO_in-network-rates.zip` | `https://transparency-in-coverage.optum.com/api/v1/oh/blobs/download/2026-11-01_Optum-Health_STATE-OF-OH-BH-STATE-OF-OHIO-MMO-PPO_in-network-rates.zip` |

These are observed locators, not validated rate bytes or replacement mappings for all 18,604 Medical Mutual plan objects. No rate body was downloaded. In particular, an `MMO` substring is not enough to join the entire outer TOC's plan set to four Ohio files.

The portal's observed Ohio TOC locator was:

`https://transparency-in-coverage.optum.com/api/v1/oh/blobs/download/2026-11-01_Optum-Health_STATE-OF-OH_index.json`

Normal browser navigation redirected to `https://tic-prod.optum.com/optumodd/2026-11-01_Optum-Health_STATE-OF-OH_index.json` with a signing query supplied by the issuer. That destination returned:

- Error code: `AuthenticationFailed`.
- Error detail: `Signature did not match`.
- Upstream request ID: `327c2015-201e-0021-3bdf-6ccc8b000000`.
- Upstream server time: `2026-11-05T04:38:46.8786611Z`.

Direct non-browser requests to the portal root and TOC API returned HTTP 403 from Microsoft Azure Application Gateway. Those transport observations are separate from the browser-visible signed-destination failure. No CAPTCHA, credential entry, signature modification, guessed replacement URL or access-control workaround was performed. The failed metadata request produced no downloaded TOC or rate file.

External resolution requires Optum to serve a working issuer-signed TOC, or publish an explicit accessible alternative with authoritative plan-to-file mappings. Once that source is available, its complete JSON, source date, exact plan identities and file locations can be validated before an adapter change. Access to one general Optum rate file would not establish those relationships.

## Verification, evidence retention and handoff

Raw public metadata, the ZIP member inventory scan, browser-observation receipt and `MANIFEST.md` remain Air-local under ignored `tmp/source-discovery-gaps-20261105T0434Z/`. The browser-observation JSON has SHA-256 `9876d6e453fb8d7ebcdf944e6c6ed579b251a6ca32cad4464f71bd1efc0935f4`. Signing queries and raw metadata are not committed. This report preserves reproducible official locators, update dates, archive/member hashes, exact unresolved identities and the upstream failure.

The existing discovery behavior is unchanged, so no new implementation tests are required for this documentation-only checkpoint. Metadata verification consisted of bounded HTTP captures, full ZIP CRC/JSON checks, exact location scans and browser observation. The temporary research tab was closed and its closure verified. No production, credentials, rate-file ingestion, paid resources, other checkout changes or canonical-memory updates occurred. No keeper-managed product doctrine changed; Notion sync is not applicable.

Next action belongs to the source owners: explicit Cigna identity resolution and a functioning Optum TOC. Mini can retain these as external discovery gaps while continuing independently authorized source acceptance. This research receipt does not certify whole-plan completeness, current network membership, or production acceptance.
