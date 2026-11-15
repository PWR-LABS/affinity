# Public guru budget and fair-use verification — November 12, 2026

Human intent: authorize a $100 monthly public [affinity.] allowance and prevent one visitor from consuming the pool. This implements the allocation and anonymous fair-use controls; it does not authorize or establish a deployment.

Source base: `aadd233e797f502daeba31cf85ead21d094d6a36`, isolated branch `codex/guru-public-allowance`. The primary Mini checkout's existing `SiteShell.tsx` edit remains untouched. This slice is uncommitted/unpushed under the supplied Codex Working Rule requiring a commit request.

- Monthly reservation ceiling $100; daily pacing ceiling $5. Lower environment caps supported, larger values rejected.
- Signed browser: 3/minute, 10/UTC day, 50/UTC month. Shared network: 10/minute, 30/day, 150/month. Browser/network identity is not verified person identity.
- All counters and money reservations share the PostgreSQL transaction advisory lock. UUID replay (including letter-case changes) cannot dispatch again. Unknown/lost provider responses retain reservations. Quota failures return 429 and Retry-After without provider dispatch; guided tools remain available.
- Missing stable signing secret, missing/malformed verified ingress address, expired pricing and failed database access fail closed.
- Additive fair-use migration only; production database and credentials unchanged. No raw address, cookie token, conversation or household answers in the ledger.

Verification on Mini with pinned Node 24.22.1: TypeScript `--noEmit --incremental false` passed; all **332 application tests passed**. Initial full-suite loading failed for ten ingestion test files because this isolated tree lacked their existing `stream-json` dependencies; a temporary link to the already installed ingestion dependencies resolved those failures, with no dependency installation. The temporary link was removed afterward.

The disposable loopback PostgreSQL 18 evaluator passed two-client concurrent money admission, duplicate rejection, restart/reconnect persistence, retained uncertain-call reservation, zero dispatch on quota denial, concurrent browser/network quotas, daily/monthly limits, new-cookie shared-network denial and old identifying-hash cleanup while preserving accounting. Database `affinity_guru_e2e_20261112` was task-created, synthetic only, and removed with its stopped temporary cluster. No production database or external model call was used.

Still required before live activation: protected visitor secret; both ledger migrations through the authorized path and current database headroom review; spoof-resistance proof for the configured ingress header on custom and direct service hostnames; current pricing and exact release checks; production configuration/deployment and hosted readback. No full production build or hosted-browser acceptance is claimed by these source checks. The former one-time evaluation budget is unchanged. Notion sync is not applicable to this unshipped operational control slice; the repo runbook owns the instructions.
