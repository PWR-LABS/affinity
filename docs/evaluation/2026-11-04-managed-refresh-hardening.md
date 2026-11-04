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

## Real source acceptance and installed runtime — 22:34 UTC checkpoint

The complete Anthem archive passed gzip/JSON EOF and full parent hash validation: 23,470,702,388 decoded bytes,147,021 reporting structures,297 selected file projections,zero unresolved file selections. The explicit2,522-employer scope produced1,349,529 exact source plan-object mappings across those files (maximum13,407 per projection); these are local projection counts, not published database counts.

A representative signed Anthem rate source passed complete extraction, projection lineage and atomic production publication: file `cmw2p0f230000zyzs0yhwpid0`,40,207 memberships,327 plan links,source date2026-11-01. Public positive-listing and absent-provider unknown checks pass. The source entity is taken from its body; a hosting region or hostname never substitutes for coverage geography.

Medical Mutual now has46 current managed sources:45 initial publications plus managed adoption of the existing SuperMed source. One legacy version is inactive and retained. The replay reconciliation did not duplicate the original45 files; older runner output labelled replay results as published, and the final runner now reports them as verified unchanged.

The real PHCS ZIP container is valid:28,050,761 compressed member bytes,393,302,598 decoded bytes. ZIP support is implemented and fixture-verified, but this source exceeds the200,000-membership acceptance cap and remains withheld. The other Medical Mutual gaps are an HTML portal and two oversized source files. Cigna's two missing historical network identities remain unresolved.

The pinned installed Mini command completed a14-source Cigna replay without duplicate rows. The existing06:00 Eastern heartbeat was updated and read back to invoke only the installed command; obsolete missing-credential guidance was removed. An overlapping run returned expected deferred status without clobbering the active run. The wrapper holds an idle-sleep assertion and validates its pinned Node24 runtime. The final runtime revision will be recorded after the last integration commit.

Full eligible Anthem publication is the remaining data run. Current compact-scope validation is complete; nationwide/whole-plan completeness is still unverified. No paid Render resource change was made.

## Live failure hardening — 22:47 UTC

PR11 is live at `cc710a2f2762f984a09c47c57f6143881cea35c1`; public health reports that exact commit and a healthy database. The first larger eligible Anthem source exhausted the worker's 1 GB heap while collecting references, before any publication. Its protected source archive was retained.

Strict extraction now caps conservatively charged allocation units at 16 MiB per collected group/reference and 64 MiB across retained references. These are accounting budgets, not a claim about exact heap bytes. The exact archived failing source now rejects with `reference_memory_limit` in 309 ms at 104 MiB peak RSS, leaving production untouched. A small supervisor marks only its own worker's abandoned running checkpoint as failed after an abnormal exit. The scheduler caches deterministic memory and duplicate-reference failures by source ETag and policy version.

Air independently reproduced a stale-PID-lock takeover race. The replacement holds a SQLite write reservation on an internal persistent inode throughout each run; OS cleanup releases it on process death. A real subprocess SIGKILL followed by two competing takeovers yields exactly one owner. Release is owner-checked and idempotent. Tests also prove an abnormal worker exit preserves published results and cannot overwrite a different worker's status.

Air's second reproduced finding concerned expired signed download URLs in cached Anthem projections. Candidates now retain the immutable parent URL for lineage and use the current official inventory URL only for transport after signature-independent identity matching. Changed host, path or semantic query parameters fail closed. The regression passes. All 202 prior application tests and this additional transport regression pass; typecheck passes. No serving code changed in this local-runner patch, so its merge can skip a Render build.

## Completed source pass — 23:01 UTC

The installed runtime `fcda13a670266abc3d88e8b9238125e5c74aee8f` has the same tree as merged main `0e0eb2c216891773964eec8ae28c32f38fd8fd63`. Air independently read and accepted both reviewed fixes at that exact revision; Mini executed the tests and production run. PR12 skipped the redundant Render build as intended. The public serving release remains healthy at PR11 `cc710a2f2762f984a09c47c57f6143881cea35c1`.

All 297 selected Anthem files received a terminal disposition: 10 accepted (nine new publications plus the earlier canary replay), 121 above the 150 MB download cap, and 166 above the reference-memory accounting cap. No failed or incomplete candidate published. The ten accepted files contain 149,184 membership records and 47,975 plan links; these are file-level records, not distinct providers or complete-plan certificates.

Production readback confirms 70 current managed source files, all dated 2026-11-01:

| Issuer | Files | Membership records | Plan links |
| --- | ---: | ---: | ---: |
| Medical Mutual | 46 | 530,069 | 18,676 |
| Cigna | 14 | 309,551 | 180 |
| Anthem | 10 | 149,184 | 47,975 |
| Total | 70 | 988,804 | 66,831 |

Database size is 1,507,530,431 bytes within the unchanged 5 GB allocation. One inactive legacy version remains retained. SSD usage is approximately 22 GiB within the 100 GB task cap. No paid service, cron, disk, tier or autoscaling change occurred. Medical Mutual's four gaps and Cigna's two unresolved historical names remain explicit, alongside the 287 bounded Anthem gaps. This completes the bounded source pass, not nationwide or whole-plan coverage.

Cleanup verified: temporary database-owner bridges removed, test PostgreSQL stopped, extra standalone sleep assertion stopped, no task-opened browser tabs retained. The active wrapper owns its own sleep assertion. Mini power settings already have system/disk sleep disabled on AC; no settings change was made. Protected publisher credential remains owner-only 0600. The exact scheduled all-issuer command is undergoing its final replay check before closing the operational receipt.

The first final all-issuer replay exposed nine unnecessary Medical Mutual extractions: its HEAD response advertised a different ETag than the identical GET bytes, despite unchanged source hashes and identical plan mappings. Production data remained intact. A real conditional GET with the archived ETag returned 304. The runner now requests the same identity encoding for HEAD and GET, accepts a conditional 304 only for already validated unchanged mappings, and can reuse the validated receipt after a full download proves the same source hash and exact source URL. A changed source hash or plan mapping still requires preparation. Redundant downloaded bytes are removed only after publication readback and dual hash checks, with the original retained and a deletion manifest saved. The added tests reject changed duplicate bytes and disconnects. All 205 application tests and typecheck pass.
