# Bounded employer refresh — November 4, 2026

The evidence-safety fix in PR #8 is deployed and verified at `565f97879c9206b4ee179857bc3f4e3cc78ff8f6`. The old production sources were correctly withheld. A current selected Medical Mutual SuperMed source has now been published through the validated transactional path, restoring the checker for recent listings.

## Source and scope

The [official Medical Mutual transparency page](https://www.medmutual.com/Employers/No-Surprises-Act-Transparency-Under-the-Consolidated-Appropriations-Act-2021.aspx) points to its public MRF portal. The downloaded [November 1 table of contents](https://mrf.healthsparq.com/mmo-egress.nophi.kyruushsq.com/prd/mrf/MMO_I/MMO/2026-11-01/tableOfContents/2026-11-01_Medical-Mutual-Of-Ohio_index.json.gz) identifies the [selected SuperMed 01 file](https://mrf.healthsparq.com/mmo-egress.nophi.kyruushsq.com/prd/mrf/MMO_I/MMO/2026-11-01/inNetworkRates/2026-11-01_01_Medical-Mutual-Of-Ohio.json.gz). Both report November 1; the selected rate archive is 2,619,615 bytes.

Extraction produced 79,414 unique NPI/TIN memberships with no NPI allowlist, missing external references, or malformed row skips. The selected TOC mapping contains 14,949 unique plan-link records after exact duplicate removal. These are **file-to-plan links, not 14,949 independently verified plan networks**. One employer identifier may span multiple plans. Other Medical Mutual files, external network files, Anthem and Cigna sources were not refreshed in this slice.

## Publication and verification

- Code checkpoint used for publication: `bb6a9ed` on `codex/employer-refresh`.
- Source, TOC and extracted membership hashes were validated. The publisher inserted the new source and all rows in one transaction, preserving all 317 pre-existing files.
- Transaction committed November 4 at 20:44:44 UTC. Independent Render inventory found 318 files and exactly one recent source, dated November 1.
- Direct database readback confirmed 79,414 memberships and 14,949 plan links for the new file. The public API returned a recent source-attributed listing for a public-data canary and `unknown/incomplete_index` for an absent NPI. Search returned current SuperMed entries and `/verify` displayed its available checker.
- Database size changed from 1,244,427,967 to 1,265,743,551 bytes: +21,315,584 bytes. No instance, disk, subscription or service change was made; no assertion about invoice overages is implied.
- [Readback receipt](2026-11-04-employer-refresh.json). Reproduction and recovery contract: [bounded refresh workflow](../EMPLOYER_REFRESH.md).

Verification on Node 24.22.1: 160 application tests, all 13 readiness gates, typecheck and optimized build passed. The existing 16 extraction-tool tests passed, including large-input memory checks; the added source-URL preservation and membership-limit regression passed separately. A real disposable PostgreSQL test verified hash/count/date/map rejection, rollback after the first insertion batch, replay refusal, exact-ID withdrawal preserving old data, and publication/join checks using the actual current source. No patient profile was used.

## Limits and next work

This is a completed **bounded refresh**, not an automated national refresh system. It adds no evidence for negative coverage, Medicare provider networks, or drug coverage. Scheduled discovery/download, expanded issuer selection, complete plan inventories, validated remote provider references, and retention/retirement of older sources remain separate work. Existing stale sources were preserved; refreshing this one file does not renew their dates.
