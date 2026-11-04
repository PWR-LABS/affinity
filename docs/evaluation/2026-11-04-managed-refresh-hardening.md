# Mini managed refresh hardening — 2026-11-04

Human intent: finish issuer discovery, secure unattended publishing, bounded retention and removable-SSD recovery before further product expansion. Mini leads today's integration; Air supplied isolated discovery/projection modules.

Technical contract: no new paid Render service, cron, disk or size change. Mini performs download/extraction on the verified optional SSD, using a protected limited database role. Complete candidates publish atomically; only active content versions answer queries. Current plus one predecessor remain available, and retirement requires verified archive ownership/bytes. Missing storage defers safely without making a phantom mount or affecting public serving.

Verified through 22:17 UTC:

- PR10 merged and live at `16ce500fd6d0176b433fa673b1a2c32f272faed8`; public health reports that commit and a healthy database.
- Dedicated publisher has no superuser, database-creation or role-creation rights; unrelated employer-table access is denied. Temporary owner bridges were removed. Credentials stay in owner-only Mini application support, never Git or SSD.
- Medical Mutual initial managed batch: 45 new sources, 450,655 memberships and 3,727 plan links. Existing SuperMed was previously published separately. External portal, ZIP and oversized source cases are explicit gaps; managed adoption/replay is in progress.
- Cigna: all 14 currently discovered historical network identities published, totaling 309,551 memberships and 180 plan links. Two historical names remain unresolved. A second cycle validated all 14 as unchanged; managed row count stayed at 59 (45 Medical Mutual plus 14 Cigna), with no duplicate files. Production positive-listing and absent-provider unknown checks pass.
- Anthem complete November TOC archived: 11,517,571,151 bytes, SHA-256 `c0f718b51b50d3a6694112d96f7b88e6e6c71ed22e5163e197454e686dd4f4c3`. This is download proof, not yet complete JSON/mapping acceptance. Parent validation remains running.
- The actual Anthem source omits some optional plan names. Projections preserve that absence; the serving layer retains an empty name and displays an explicit unavailable-name label. Identifiers remain mandatory.
- Nationwide per-file plan mappings exceeded the serving cap. The compact projection explicitly selects the 2,522 previously indexed Anthem employer identities (including discovery samples), retaining exact source mappings only for that declared set. Other employers and whole-plan/national completeness remain unverified.
- Application tests: 196 passed. Selected-TOC and lineage tests: 16 passed, including a 142 MB distinct-plan fixture under a 64 MiB heap limit. Typecheck and production build passed.
- Ten real PostgreSQL recovery checks pass: reused URLs, same-date revisions, active-only answers, mid-insert and post-retention disconnect rollback, committed-but-unacknowledged replay, corrupt archive refusal, current/rollback preservation, scoped disk reclamation, withdrawal, and old monthly-ledger identity reconciliation. Four standalone publication safety checks also pass.

Limits: this is selected-source evidence, never a negative network certificate. Full Anthem acceptance, remaining external formats, pinned runtime installation and schedule cutover remain in progress. No physical unplug/eject test occurred; disconnect cases use injected faults. Shared large parent TOCs and legacy archives remain protected under the 100 GB task cap; reaching that cap defers work instead of deleting unreviewed evidence. Database staging budget is 2.5 GB within the existing 5 GB allocation.

Notion: no keeper-managed product doctrine changed in this code/operations slice; existing doctrine sync is unchanged. Git checkpoint does not imply cross-device execution ownership or complete refresh acceptance.
