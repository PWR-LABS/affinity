# guru coverage workspace

The guru-first homepage implements a guided coverage journey alongside a shared workspace. Discover separates employment from an actual individual or household employer offer; Coverage checks an exact doctor/plan pair; Compare annualizes user-declared employer or Medicaid premiums against a Marketplace amount; How supplies a replayable confirmation plan and official handoffs. The full screening, Marketplace, employer and selected Part D tools remain reachable. This is decision support, not enrollment or a complete Medicare comparison.

The guided journey works without a model, model credential or allowance. Its free-text task routing is deliberately simple and labeled guided mode. Source-backed answers come from existing application APIs. Connected guru is a separate optional conversational path, enabled only by operator configuration and the user’s checkbox. It carries bounded recent conversation and confirmed context, asks for missing facts, explains current tool evidence, and proposes explicit context edits or a supported check for confirmation. The server resolves applicable evidence through allowlisted application handlers; client prose and earlier conversation are not evidence authority. Model explanations remain fallible and are labeled AI explanations. The application computes premiums and renders source status independently. A suggested check is not a completed tool execution.

## Context and evidence

Household fields and selected medications live in a client context provider across site navigation, without URLs, localStorage or database persistence. Clearing guru also clears this in-memory selection store. Changing relevant inputs invalidates evidence cards and visibly supersedes earlier bound chat claims; changing source facts/status/date with the same inputs does the same, while a retrieval timestamp alone does not. Source-content fingerprints are change detectors, not authentication. Confirmed household-size changes reset the same-people premium basis through the central context writer, including full forms and conversational edits. Doctor, employer and plan names use existing explicit match selectors; a new search name clears its old identifier. Changing relevant inputs invalidates results; request sequence and snapshot checks prevent late responses from an earlier context becoming current. Existing full screening and Marketplace forms also invalidate their results on relevant changes.

Doctor evidence must match the requested NPI and plan identifier. Only a current, explicitly listed issuer result can receive a listing label. Absence, stale dates, unsupported dates and conflicting statuses stay unknown. An EIN may cover several benefit options, so a listing is not confirmation of the individual's actual option or a future-year promise. Source-internal date and lookup time are distinct. Full Marketplace results remain premium estimates with separate care-fit checks.

An employer or household-member offer is never inferred from employment. The new forms and guru withhold subsidized estimates until the user confirms there is no relevant employer offer; otherwise they direct the user to official affordability/minimum-value review while retaining state Medicaid and comparison handoffs. This is a limit of the local screening, not a finding that employed people cannot qualify. [HealthCare.gov explains the employee and household review](https://www.healthcare.gov/have-job-based-coverage/change-to-marketplace-plan/). No annual affordability threshold is hardcoded here.

## Connected conversation activation

Default: **off**. Building the adapter does not approve recurring spend or a deployment. The Mini's completed one-time three-model benchmark is separate; see [measured results](evaluation/2026-11-09-guru-model-benchmark.md). Terra is the next integration candidate, not an accepted production winner. Voice, document images/OCR, autonomous enrollment and source publication are outside this slice.

Before enabling:

1. Review the exact feature checkpoint, fixture/browser evidence, and a separately authorized real-model adapter exercise. Obtain the operator's walkthrough acceptance and deployment/recurring-budget decisions.
2. Use the existing authorized database migration path to apply `20261110000000_guru_budget`; verify existing allocation/headroom without increasing resources. The new table stores only request UUID, reserved microdollars and timestamp. No production migration has been performed by this implementation.
3. Configure the server-only dedicated key and explicit reviewed model, `AFFINITY_GURU_MONTHLY_USD` and `AFFINITY_GURU_DAILY_USD`, then opt in with `AFFINITY_GURU_ENABLED=1`. Missing or invalid configuration, unavailable ledger, stale pricing, quota exhaustion or provider failure leaves guided mode available. Public monthly/day allowances remain unapproved unless a later operator receipt settles them.
4. Confirm privacy disclosure, same-origin requests, source readiness and model/provider behavior on the actual hosted release. A local build is not a deployment receipt.

Every turn first reserves **$0.05** in the shared PostgreSQL ledger under a transaction advisory lock. Both aggregate UTC calendar-day and calendar-month caps apply. Concurrent clients share the same rows; restarting the app cannot reset the allowance. A repeated UUID cannot dispatch again. Reservations are retained after successful responses, timeouts, refusals or missing responses; there are no automatic retries or refunds. The reservation is conservative, not an invoice or actual per-turn cost. Withholding after allowance exhaustion affects AI availability; guided tools remain available.

The text-only request is bounded to 12,000 serialized UTF-8 bytes plus a 4,096-token framing allowance and 1,000 maximum conversational output tokens (800 for the earlier planner). At the reviewed most expensive candidate rates, including the 1.25× input cache-write allowance, the reservation exceeds the configured upper estimate. Pricing is pinned to November 9 and fails closed after seven days or before that date; review published rates before refreshing the code's pricing date. The full most recent accepted user message is preserved through the composer’s 1,500-character limit. Up to eight recent messages are carried, with older messages bounded to 750 characters each and omissions explicitly marked; oldest messages are trimmed further when needed to fit the conservative upper reservation. Confirmed context and current evidence are never silently trimmed. Extended cache retention, images and provider-side tools are not requested. Requests use `store:false`; this is not a provider zero-retention guarantee. [Official structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Verification

Run the ordinary application suite and typecheck/build with a client generated from the checked-out Prisma schema. Additional gates:

```sh
# Model-free, loopback preview only; API and model responses are synthetic fixtures.
AFFINITY_EVAL_APP_URL=http://127.0.0.1:3012 node scripts/eval-guru-browser.cjs

AFFINITY_EVAL_APP_URL=http://127.0.0.1:3012 node scripts/eval-guru-conversation-browser.cjs

# Fresh disposable database, never DATABASE_URL or a production connection.
# Database name must match affinity_guru_e2e_<digits>; CREATE refuses an existing table.
AFFINITY_GURU_TEST_DATABASE_URL=postgresql://LOCAL_USER@127.0.0.1/affinity_guru_e2e_12345 \
  node --import tsx scripts/eval-guru-budget.ts
```

Browser tooling accepts `AFFINITY_PLAYWRIGHT_MODULE` and optional `AFFINITY_TEST_BROWSER_CHANNEL`. It launches an isolated headless test context, does not use a signed-in profile, and closes it. The database evaluator exercises two independent clients, concurrent cap admission, duplicate identity, reconnect and uncertain-response reservation. It makes zero external model calls. Remove only the exact task-created synthetic database after checking the result.

## Conversational acceptance remains separate

The original guided/input-planner prototype did not meet the operator’s requested conversational completion bar. This extension adds the multi-turn protocol and eight fixed synthetic held-out cases in `scripts/guru-integration/conversation-cases.ts`. Unit and build validation are separate from mocked browser flow, actual-model adapter evaluation, independent semantic review and an interactive operator walkthrough. No new model result or user acceptance is implied by source installation. The Mini must preserve the original one-time $5 aggregate cap across its immutable 228-request baseline, any held-out conversation turns and private interactive review. The public production ledger must not be used as an independent second evaluation allowance.

## Private synthetic review runtime

The private review uses the same conversational adapter with the Mini’s dedicated key and original aggregate benchmark ledger. `scripts/guru-private-review-proxy.cjs` listens only on `127.0.0.1:3013`, provides a disclosure at `/review`, serves the existing app on loopback3012 and routes only connected guru to the reviewed Mini gateway on loopback3127. Fictional name selectors and unknown-only coverage fixtures avoid production/CMS data access. The gateway derives its own explicitly synthetic evidence; the browser cannot supply trusted evidence, model, phase or ledger controls. No deployment or recurring allowance is enabled by this utility.

The Mini can run the app with existing dependencies in an isolated current-source checkout using Next development mode, avoiding a second dependency installation or full production build. It must verify source, available disk and listeners first, then start the gateway only after its exact source pin and allocation amendment are reviewed. On the Mini, the review address is `http://127.0.0.1:3013/review`. This address is local to that computer. The Air walkthrough uses an independently verified existing authenticated loopback forward for3127 to the Mini gateway, with the current-source app on Air3012 and the review proxy on Air3013. The Air disclosure/app/gateway and invalid-schema rejection path were verified without a provider dispatch; see the current demo receipt. The address `http://127.0.0.1:3013/review` is local to whichever computer runs that proxy. Device credentials and private connection configuration remain outside the repository.

The first eight actual conversational cases at protocol56e180a exposed omitted explicit proposals and premature edit prose; their failures remain in the dated held-out report. The repair source8ed7bf5 adds an explicit pending-proposal contract and a narrow recognizable-completed-edit guard. This guard is not complete semantic verification. The reviewed append-only allocation amendment preserves all old records and redistributes future slots to two named repair probes plus eight interactive turns, keeping eighteen extension requests and the same original $5 maximum. Source and test installation do not establish those probes passed or that a human walkthrough occurred.

## State-contract repair and reviewed continuation

Protocol5534ee6 aligns the app and model state enums using the supported registry, normalizes explicit recognized full names through the shared proposal parser, and rejects unknown locations. Its registry dependency is included in the seven-file source pin. The guided transition path asks about benefit changes and dates instead of comparing absent premiums. Missing amounts come before same-people confirmation. [Source and synthetic verification](evaluation/guru-state-contract-repair.md).

The private preview may use operator-authorized real context; its insurer/source fixtures remain synthetic. Keep all interactive request/provider/result artifacts private, including during diagnosis and failure review. Do not export or replay them as fictional benchmark cases. A reviewed failure retains its terminal record and reservation; only future new IDs against the explicitly reviewed source can proceed under the same aggregate cap. Review and caller installation do not establish a successful private workflow or application acceptance.
