# SSD-backed large issuer processing — 2026-11-04

Human intent: process the currently blocked larger issuer files on Mini/SSD while keeping the Render allocation and recurring infrastructure unchanged. Mini leads integration today; Air implements and tests the isolated disk extractor.

## Cost and serving contract

Live Render verification: Basic 256 MB database, 5 GB allocated storage, automatic disk expansion disabled, no high availability or replicas. Current database size at this slice's start is 1,507,530,431 bytes. The existing web service stays unchanged. No Render worker, cron, disk, paid service or resize is part of this work.

Local input limits increase independently of cloud output limits. Inputs can be up to 2 GB compressed, with 4 GB of temporary SQLite scratch and up to 64 GB decoded data. Downloads and extraction each have a 30-minute deadline. The daily cycle permits eight new candidates by default and has a four-hour budget; already accepted and known-blocked sources do not consume the new-attempt budget. The exact verified SSD still requires 150 GB free space and a 100 GB aggregate task cap. Reserving a source also reserves scratch and compact output before I/O.

Cloud publication still requires a complete selected-source result: at most 200,000 membership records and 30,000 plan links, with no silent truncation. Before upload, record the measured database size and the conservative row reservation; refuse work beyond the existing 2.5 GB staging budget. The transaction independently rechecks its existing budget. Bigger local inputs never authorize a bigger cloud allocation.

## Initial measured source

The previously oversized Medical Mutual-linked Cigna source downloaded entirely to the SSD in 22.8 seconds: 1,664,655,530 bytes, SHA-256 `2c64b1374da943b0359d1d5cd1d01d2df24070577f7d922ce0b5320a14f17459`. This proves the bounded larger-download path, not complete extraction or suitability for publication. No cloud writes occurred.

Disk-backed extraction, real-source acceptance and installed-runtime integration remain in progress. Existing 70-source production data and the previous pinned daily runtime remain intact during development.

## Extractor integration evidence

Air's isolated extractor arrived at `49c08b922acee9badbe658483bf3d838d4dc53ee` and was integrated as `586230a`. Mini independently reran all 12 disk-extractor tests plus the complete preparation/receipt integration test. The full integrated application suite passes 219 tests; typecheck passes. The isolated 32 MiB heap fixture processed 39,200,347 decoded bytes, 100,000 unused groups and a 3,000,001-NPI used group with 9,126,086 peak scratch bytes and about 121 MiB peak process RSS. Repeated inline groups compact rather than growing the disk catalog per billing entry. Bad tails/CRC, reference closure, source changes, bounds and storage replacement fail before output activation.

Real previously blocked Anthem source `2026-11_425_61B0_in-network-rates_2_of_10.json.gz` passed: 46,356 membership records, 36,018 NPIs, 11,486 plan links, 6,474,750 decoded bytes, 133,259,116 peak scratch bytes. Disk output SHA-256 `e327014024529c2da10a9c94ac064d4f668288672b61f91ba4dc193108a5bdbd` exactly matches the independently preserved legacy baseline. The disk path took 5.398 seconds at 127 MiB peak RSS versus 1.296 seconds and 240 MiB RSS for the explicitly bounded legacy comparison. This is a memory-for-local-I/O tradeoff, not a claim that SSD processing is always faster.

Its conservative publication reservation is 92,506,000 bytes, giving projected database usage of 1,600,036,431 bytes against the unchanged 2.5 GB safety ceiling. This is a reservation estimate, not measured post-publication size. No data publication has occurred in this expansion slice yet. The larger 1.66 GB Cigna archive is undergoing full disk-backed processing separately.
