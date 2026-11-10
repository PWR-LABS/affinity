# guru coverage workspace

The guru-first homepage implements a guided coverage journey alongside a shared workspace. Discover separates employment from an actual individual or household employer offer; Coverage checks an exact doctor/plan pair; Compare annualizes user-declared employer or Medicaid premiums against a Marketplace amount; How supplies a replayable confirmation plan and official handoffs. The full screening, Marketplace, employer and selected Part D tools remain reachable. This is decision support, not enrollment or a complete Medicare comparison.

The guided journey works without a model, model credential or allowance. Its free-text task routing is deliberately simple and labeled guided mode. Source-backed answers come from existing application APIs. Model-assisted routing is a separate optional path, enabled only by operator configuration and the user's checkbox. It proposes a step and context edits for confirmation; the schema cannot issue coverage, eligibility, source, price or completed-action claims. The application computes premiums and renders source status independently. A model proposal is not a tool execution.

## Context and evidence

Household fields and selected medications live in a client context provider across site navigation, without URLs, localStorage or database persistence. Clearing guru also clears this in-memory selection store. Changing relevant inputs invalidates results; request sequence and snapshot checks prevent late responses from an earlier context becoming current. Existing full screening and Marketplace forms also invalidate their results on relevant changes.

Doctor evidence must match the requested NPI and plan identifier. Only a current, explicitly listed issuer result can receive a listing label. Absence, stale dates, unsupported dates and conflicting statuses stay unknown. An EIN may cover several benefit options, so a listing is not confirmation of the individual's actual option or a future-year promise. Source-internal date and lookup time are distinct. Full Marketplace results remain premium estimates with separate care-fit checks.

An employer or household-member offer is never inferred from employment. The new forms and guru withhold subsidized estimates until the user confirms there is no relevant employer offer; otherwise they direct the user to official affordability/minimum-value review while retaining state Medicaid and comparison handoffs. This is a limit of the local screening, not a finding that employed people cannot qualify. [HealthCare.gov explains the employee and household review](https://www.healthcare.gov/have-job-based-coverage/change-to-marketplace-plan/). No annual affordability threshold is hardcoded here.

## Connected routing activation

Default: **off**. Building the adapter does not approve recurring spend or a deployment. The Mini's completed one-time three-model benchmark is separate; see [measured results](evaluation/2026-11-09-guru-model-benchmark.md). Terra is the next integration candidate, not an accepted production winner. Voice, document images/OCR, autonomous enrollment and source publication are outside this slice.

Before enabling:

1. Review the exact feature checkpoint, fixture/browser evidence, and a separately authorized real-model adapter exercise. Obtain the operator's walkthrough acceptance and deployment/recurring-budget decisions.
2. Use the existing authorized database migration path to apply `20261110000000_guru_budget`; verify existing allocation/headroom without increasing resources. The new table stores only request UUID, reserved microdollars and timestamp. No production migration has been performed by this implementation.
3. Configure the server-only dedicated key and explicit reviewed model, `AFFINITY_GURU_MONTHLY_USD` and `AFFINITY_GURU_DAILY_USD`, then opt in with `AFFINITY_GURU_ENABLED=1`. Missing or invalid configuration, unavailable ledger, stale pricing, quota exhaustion or provider failure leaves guided mode available. Public monthly/day allowances remain unapproved unless a later operator receipt settles them.
4. Confirm privacy disclosure, same-origin requests, source readiness and model/provider behavior on the actual hosted release. A local build is not a deployment receipt.

Every turn first reserves **$0.05** in the shared PostgreSQL ledger under a transaction advisory lock. Both aggregate UTC calendar-day and calendar-month caps apply. Concurrent clients share the same rows; restarting the app cannot reset the allowance. A repeated UUID cannot dispatch again. Reservations are retained after successful responses, timeouts, refusals or missing responses; there are no automatic retries or refunds. The reservation is conservative, not an invoice or actual per-turn cost. Withholding after allowance exhaustion affects AI availability; guided tools remain available.

The text-only request is bounded to 12,000 serialized UTF-8 bytes plus a 4,096-token framing allowance and 800 maximum output tokens. At the reviewed most expensive candidate rates, including the 1.25× input cache-write allowance, the reservation exceeds the configured upper estimate. Pricing is pinned to November 9 and fails closed after seven days or before that date; review published rates before refreshing the code's pricing date. Extended cache retention, images and tools are not requested. Requests use `store:false`; this is not a provider zero-retention guarantee. [Official structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

## Verification

Run the ordinary application suite and typecheck/build with a client generated from the checked-out Prisma schema. Additional gates:

```sh
# Model-free, loopback preview only; API and model responses are synthetic fixtures.
AFFINITY_EVAL_APP_URL=http://127.0.0.1:3012 node scripts/eval-guru-browser.cjs

# Fresh disposable database, never DATABASE_URL or a production connection.
# Database name must match affinity_guru_e2e_<digits>; CREATE refuses an existing table.
AFFINITY_GURU_TEST_DATABASE_URL=postgresql://LOCAL_USER@127.0.0.1/affinity_guru_e2e_12345 \
  node --import tsx scripts/eval-guru-budget.ts
```

Browser tooling accepts `AFFINITY_PLAYWRIGHT_MODULE` and optional `AFFINITY_TEST_BROWSER_CHANNEL`. It launches an isolated headless test context, does not use a signed-in profile, and closes it. The database evaluator exercises two independent clients, concurrent cap admission, duplicate identity, reconnect and uncertain-response reservation. It makes zero external model calls. Remove only the exact task-created synthetic database after checking the result.
