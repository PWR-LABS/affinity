# Selected issuer refresh checkpoint — November 5, 2026

Human intent: finish the selected issuer refresh and unattended hardening using the Mini and removable SSD, with no additional Render allocation.

Observation: Mini, November 5, 2026. All timestamps below are UTC. This is an incomplete refresh checkpoint, not a whole-plan or national coverage claim.

## Exact remaining scope

At `2026-11-05T14:09:52.173Z`, the current four official Anthem EIN inventories reproduced the exact retained selection identity hash `b77b7edbfa425979b6327f946cb90405855674d1c8b79010898ddad2066548a7`. The check fetched only bounded inventory metadata and compared normalized source identities with active, current production files; it did not read or substitute bulk SSD data.

- 297 selected source identities; 208 current; 89 remaining.
- Three of the remaining identities have the confirmed reference-closure gap below.
- The other 86 still require complete source processing or an explicit assessment. They are not accepted by this checkpoint.
- The existing scope remains four EIN inventories and 2,522 previously selected employer identities. Matching the selection hash does not replace complete parent-TOC validation for publication.

## Independent reference-closure audit

Each official source was streamed using its existing issuer-supplied transport locator. Signing queries were omitted from diagnostic outputs. No raw or normalized payload was stored internally, and no database publication occurred. The audit consumed the entire compressed body, checked its SHA-256 against the rejected download, verified gzip completion, strict UTF-8 and complete JSON tokenization, and collected only bounded definition/use ID sets.

| Source under `https://anthembcbsoh.mrf.bcbs.com/` | Completed observation | Seconds |
| --- | --- | ---: |
| 2026-11_062_07B0_in-network-rates_2_of_2.json.gz | 2026-11-05T14:06:53.492Z | 54.079 |
| 2026-11_062_07D0_in-network-rates_2_of_2.json.gz | 2026-11-05T14:07:40.721Z | 47.227 |
| 2026-11_062_07T0_in-network-rates_2_of_2.json.gz | 2026-11-05T14:08:30.891Z | 50.168 |

All three bodies are byte-identical: 243,315,467 compressed bytes, SHA-256 `dd340e975de47837f97ddcc30b52cd724c3f67bf66200ea6e59fc8d80b7058c5`; 1,026,766,846 decoded bytes. Each defines 25,040 unique provider-group IDs and uses 32,890 distinct IDs across 103,419 references. Exactly 7,850 used IDs are absent from its definitions. IDs are numeric; normalizing numeric representations does not resolve any missing ID. Examples start at `620080025041`, `620080025042` and `620080025043`.

This independently confirms that each inspected file is not self-contained under the current complete-source reference contract. It does not establish whether another file contains the missing groups or authorize cross-file inference. The validator correctly withheld these sources. Publishing only resolvable groups, inferring definitions from file-name similarity, or treating absence as non-coverage would violate the acceptance boundary.

Small diagnostic receipts remain Mini-local at `tmp/employer-refresh/reference-closure-{B,D,T}.json`; the one-off audit script SHA-256 is `67c74ab6e53b20638016d6f6d039e7729eb7acff13e225e0613b87bc7d3a8ed6`. Fixtures covered complete closure, genuinely missing IDs and numeric representation differences. The three live complete bodies matched the original rejection hashes. Existing cached blocks prevent unchanged rejected sources from being treated as accepted.

## Storage fault and installed hardening

The SSD remained mounted while a tiny-file read hung; kernel logs showed repeated USB pipe-stalled/storage I/O errors. The exact physical-store mapping of the logged USB model was not independently verified. No physical eject, repair, forced detach or internal bulk fallback was performed. The main publisher had already stopped at a committed boundary. A separate local preparer has now exited; its final SSD receipt still needs readback after recovery.

PR35 installed Mini runtime `267cc5a11f845e518fbb9cf679faa9eddc8e5ae9` at `2026-11-05T14:09:28.797Z`. Independent supervisor timers bound storage preflight and the entire worker even when synchronous I/O blocks cooperative checks. Termination targets only its dedicated process group, preserves committed progress and never removes a surviving worker's locks.

Five focused supervisor tests and TypeScript passed. All 263 tests outside the ten-test native compression suite passed. The full-suite attempt reached a native `lsof` process in uninterruptible I/O during compression tests; the exact owned test process tree was identified and stopped. The ten compression tests had passed before the hardware fault. This checkpoint does not claim a new full-suite pass during that fault.

## Resource and delivery boundary

At the current readback, the database occupied 2,427,524,799 bytes, below the unchanged 2.5 GB publishing gate. Render inspection still showed one Starter web instance and Basic256MB Postgres with 5 GB disk, no disk autoscaling, high availability or replicas. The latest web deployment remained `b38e57c89f6bd84a8b3f737344f0cc77d3828cd9`, live since `2026-11-05T09:44:01.645Z`. Mini-only PR32–35 use skip-render merge subjects. This verifies unchanged resource allocation and no additional deployment in that interval, not an exact invoice forecast.

The 150 GB SSD free-space floor, 100 GB task cap, existing raw archives, source-completeness checks and public unknown-on-absence behavior remain intact. The earlier Cigna identity and Medical Mutual stale/Optum gaps remain as recorded in `2026-11-04-source-discovery-gap-review.md` and the retained refresh receipts. No keeper doctrine changed; Notion sync is not applicable. Air receipt remains pending.

Next executable step: restore responsive access to the exact approved SSD, verify its identity and retained checkpoints, then resume the pinned Mini runtime and assess all 86 remaining unprocessed identities. Mounted metadata alone is insufficient recovery evidence. The operator has been asked whether the SSD remains physically attached; no answer was available when this checkpoint was written.

## Recovery observation — 18:00–18:08 UTC

The approved SSD responded again at `2026-11-05T18:00:14.573Z`: exact UUID and mount checks passed, the entire 4,030-byte root manifest was read successfully, and 164,620,398,592 bytes were available. The cause of the earlier USB/storage fault was not established; network reconnection alone is not evidence of its cause or repair.

All 273 application tests subsequently passed, including the ten native compression tests that had been blocked. The earlier preparer batch's final receipt was recovered: two complete preparations, both already published and verified, followed by one free-space reservation deferral. No additional complete preparation was waiting to be published. Exact selected-source readback at `18:02:36.305Z` remained 208 of 297 current; the database remained 2,427,524,799 bytes.

The installed supervised Mini runtime resumed the Anthem backfill at approximately 18:03 UTC. At `18:07:57.354Z` it was actively revalidating retained evidence with 104 verified-unchanged results; that is replay progress, not 104 new publications. All source, disk and cloud limits remain enforced. The explicit catch-up run permits up to 1,000 attempts within the unchanged four-hour deadline; routine daily defaults are unchanged.

A temporary local completion check, `finish-affinity-issuer-backfill`, is active every 30 minutes in the existing Mini thread to continue this authorized backfill and remove itself once the queue is fully assessed or further continuation is non-actionable. The daily 06:00 Eastern refresh remains separate and active. Neither creates Render compute. The Air task's app connection still failed two bounded read attempts despite the operator's same-network update; no receiver receipt or cross-machine synchronization is claimed.

The refresh remains in progress. Current source counts and actual completion must be read from the latest protected checkpoint and production evidence, not inferred from this recovery entry.
