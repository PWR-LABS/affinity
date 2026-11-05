# SSD-backed large issuer processing — 2026-11-04

Human intent: process the currently blocked larger issuer files on Mini/SSD while keeping the Render allocation and recurring infrastructure unchanged. Mini leads integration today; Air implements and tests the isolated disk extractor.

## Cost and serving contract

Live Render verification: Basic 256 MB database, 5 GB allocated storage, automatic disk expansion disabled, no high availability or replicas. Current database size at this slice's start is 1,507,530,431 bytes. The existing web service stays unchanged. No Render worker, cron, disk, paid service or resize is part of this work.

Local input limits increase independently of cloud output limits. Inputs can be up to 2 GB compressed, with 4 GB of temporary SQLite scratch and up to 64 GB decoded data. Downloads and extraction each have a 30-minute deadline. The daily cycle permits eight new candidates by default and has a four-hour budget; already accepted and known-blocked sources do not consume the new-attempt budget. The exact verified SSD still requires 150 GB free space and a 100 GB aggregate task cap. Reserving a source also reserves scratch and compact output before I/O.

Cloud publication still requires a complete selected-source result: at most 200,000 membership records and 30,000 plan links, with no silent truncation. Before upload, record the measured database size and the conservative row reservation; refuse work beyond the existing 2.5 GB staging budget. The transaction independently rechecks its existing budget. Bigger local inputs never authorize a bigger cloud allocation.

## Initial measured source

The previously oversized Medical Mutual-linked Cigna source downloaded entirely to the SSD in 22.8 seconds: 1,664,655,530 bytes, SHA-256 `2c64b1374da943b0359d1d5cd1d01d2df24070577f7d922ce0b5320a14f17459`. This proves the bounded larger-download path, not complete extraction or suitability for publication. No cloud writes occurred.

The larger source trial ended with `extraction_time_limit` after 1,800,055 ms (30 minutes), under a deliberately constrained 256 MiB Node heap. Peak process RSS was 207.5 MiB. The last progress checkpoint had parsed 27,377,352,704 decoded bytes using 186,261,504 scratch bytes; this is partial progress, not complete-source acceptance or a total decompressed size. No normalized output was activated and no cloud write occurred. Temporary extraction scratch was removed, the original 1.66 GB archive and measurements remain on SSD, and the prior serving data stayed intact. Do not treat this as a permanent source rejection: the installed worker has its existing 1 GiB heap budget, and must independently pass its bounded run. No memory or resource increase on Render is authorized by either trial.

## Extractor integration evidence

Air's isolated extractor arrived at `49c08b922acee9badbe658483bf3d838d4dc53ee` and was integrated as `586230a`. Mini independently reran all 12 disk-extractor tests plus the complete preparation/receipt integration test. The final integrated application suite passes 221 tests; typecheck passes. The isolated 32 MiB heap fixture processed 39,200,347 decoded bytes, 100,000 unused groups and a 3,000,001-NPI used group with 9,126,086 peak scratch bytes and about 121 MiB peak process RSS. Repeated inline groups compact rather than growing the disk catalog per billing entry. Bad tails/CRC, reference closure, source changes, bounds and storage replacement fail before output activation.

Real previously blocked Anthem source `2026-11_425_61B0_in-network-rates_2_of_10.json.gz` passed: 46,356 membership records, 36,018 NPIs, 11,486 plan links, 6,474,750 decoded bytes, 133,259,116 peak scratch bytes. Disk output SHA-256 `e327014024529c2da10a9c94ac064d4f668288672b61f91ba4dc193108a5bdbd` exactly matches the independently preserved legacy baseline. The disk path took 5.398 seconds at 127 MiB peak RSS versus 1.296 seconds and 240 MiB RSS for the explicitly bounded legacy comparison. This is a memory-for-local-I/O tradeoff, not a claim that SSD processing is always faster.

Its conservative publication reservation was 92,506,000 bytes, giving projected database usage of 1,600,036,431 bytes against the unchanged 2.5 GB safety ceiling. Actual publication succeeded at `2026-11-04T23:53:08.228Z`: file `cmw2rujzk0000zykx887d9wi2`, all source mappings and memberships read back, positive listing returned `yes/listed`, absent provider remained `unknown`. Actual database size was 1,520,834,239 bytes, an increase of 13,303,808 bytes. There are now 71 managed files and one retained inactive legacy source. The 5 GB allocation, Basic 256 MB plan and disabled disk autoscaling were independently rechecked; no new web build or paid resource was created.

## Cost and recovery review

Eleven real local PostgreSQL checks passed, including rollback after an interrupted insertion, rollback after retention deletion before commit, legacy preservation, corrupt-archive refusal, idempotent lost-receipt recovery and explicit withdrawal. The added Anthem three-month rollover reconciles existing month-specific keys, serves one active version, retains exactly two managed versions, removes only verified oldest raw/normalized bytes and restores the predecessor on withdrawal. No production migration was required.

Air independently reviewed the Mini integration and identified replay-budget, capacity-defer and deadline edge cases. The final reviewed code revision is `848f25fae703223be48d1e1fb2b9890cad0d0899`. Full-GET unchanged replays refund provisional attempts and reserve no new rows; complete capacity-deferred preparations are reused only after matching validators, archived hashes, source identity, policy and current mappings. A committed publication with a surviving prepared checkpoint is recognized against the validated active receipt, including near the database ceiling. New inserts still face the independent transactional capacity gate. Network requests compose their own timeout with remaining cycle time; phase guards use monotonic elapsed time. Air's review was read-only; all tests, real-source processing and publication were executed on Mini.

## Installed acceptance and remaining coverage

The installed pinned command executed reviewed revision `848f25fae703223be48d1e1fb2b9890cad0d0899` through its real wrapper. At `2026-11-05T00:03:52.689Z` it verified all 14 managed Cigna sources unchanged, totaling 309,551 memberships, with zero duplicate publications. Its partial status correctly retained the two unresolved historical network names. The existing 06:00 Eastern automation was read back unchanged; it invokes this owned pinned runtime, performs no Git/dependency updates or deployments, and forbids paid resource changes. The final merge pin and corresponding code/tree checks are retained in the protected delivery receipt.

This work expands processing capability; it does not claim the remaining 286 selected Anthem files have been processed under the new limits. The eight-new-candidate daily allowance advances that backlog while preserving known unchanged sources. The large Cigna source above is still unaccepted; the Medical Mutual-linked PHCS membership overflow, Optum portal locator and two historical Cigna names remain explicit gaps. Sources exceeding input, extraction, compact-output, SSD or database limits defer or fail closed. No whole-plan or national completeness is certified, and missing provider listings remain unknown.

The final database inventory also retains legacy rows: 388 files have an active flag, of which 71 belong to this managed refresh; the legacy remainder is not evidence of current refresh acceptance. The serving freshness/unknown rules still apply. The sole inactive legacy SuperMed version is preserved. No legacy cleanup was performed.

Notion is not applicable to this operational slice: no keeper-owned product doctrine changed. Temporary comparison outputs and source archives remain SSD-local and excluded from Git. The disposable test PostgreSQL instance was stopped after its checks. No physical SSD unplug test occurred; disconnect and replacement cases are injected failures.
