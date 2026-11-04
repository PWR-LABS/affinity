# SSD-backed large issuer processing — 2026-11-04

Human intent: process the currently blocked larger issuer files on Mini/SSD while keeping the Render allocation and recurring infrastructure unchanged. Mini leads integration today; Air implements and tests the isolated disk extractor.

## Cost and serving contract

Live Render verification: Basic 256 MB database, 5 GB allocated storage, automatic disk expansion disabled, no high availability or replicas. Current database size at this slice's start is 1,507,530,431 bytes. The existing web service stays unchanged. No Render worker, cron, disk, paid service or resize is part of this work.

Local input limits increase independently of cloud output limits. Inputs can be up to 2 GB compressed, with 4 GB of temporary SQLite scratch and up to 64 GB decoded data. Downloads and extraction each have a 30-minute deadline. The daily cycle permits eight new candidates by default and has a four-hour budget; already accepted and known-blocked sources do not consume the new-attempt budget. The exact verified SSD still requires 150 GB free space and a 100 GB aggregate task cap. Reserving a source also reserves scratch and compact output before I/O.

Cloud publication still requires a complete selected-source result: at most 200,000 membership records and 30,000 plan links, with no silent truncation. Before upload, record the measured database size and the conservative row reservation; refuse work beyond the existing 2.5 GB staging budget. The transaction independently rechecks its existing budget. Bigger local inputs never authorize a bigger cloud allocation.

## Initial measured source

The previously oversized Medical Mutual-linked Cigna source downloaded entirely to the SSD in 22.8 seconds: 1,664,655,530 bytes, SHA-256 `2c64b1374da943b0359d1d5cd1d01d2df24070577f7d922ce0b5320a14f17459`. This proves the bounded larger-download path, not complete extraction or suitability for publication. No cloud writes occurred.

Disk-backed extraction, real-source acceptance and installed-runtime integration remain in progress. Existing 70-source production data and the previous pinned daily runtime remain intact during development.
