# Private conversational evaluation extension

This is local evaluation infrastructure for the operator-approved one-time $5
guru benchmark. It does not activate public AI, authorize recurring spending,
install a service or supply a model transport. The original 228-call baseline
and its $4.054254 reservation remain immutable.

`scripts/guru-benchmark/extension-ledger.ts` implements shared exclusion and
durable extension accounting. It acquires the original `publisher.lock`, checks
the exact baseline SHA-256, 228 completed unique rows, $5 cap and retained
reservation total, then validates the entire append-only extension journal.
It never writes the baseline, releases a reservation or removes a pre-existing
lock. A surviving lock, partial journal, invalid transition, failed attempt or
uncertain attempt requires review. Restarting does not bypass those conditions.

The current proposed allocation is at most eight held-out requests and ten
interactive requests, each reserving $0.05. Both phases share the same aggregate
cap and journal; they are not independent allowances. All eighteen would reserve
$0.90, producing $4.954254 aggregate reservations and $0.045746 remaining.
Smaller actual usage does not return capacity. Every request UUID is single use.

Reservation records contain only identifiers/hashes, source commit, phase, model,
timestamp and reserved amount. Terminal records add conservative usage or a fixed
failure code. No prompt, conversation, household fields, credential or provider
error body belongs in this journal. Full synthetic evaluation evidence, when
generated, belongs in a separate protected local artifact.

## Caller obligations before any paid execution

- Pin and review the conversational source, frozen synthetic fixtures and exact
  expected proposals/actions. The earlier router-only fixtures remain on hold.
- Calculate the upper cost of the actual serialized history, evidence, prompt,
  schema and output limit. The new conversation cannot inherit the old router's
  800-output-token bound. Reject a body whose conservative upper cost exceeds
  its $0.05 reservation before invoking the ledger.
- Configure root, baseline anchor, source commit, manifest hash and phase in the
  trusted Mini process. Browser input cannot select those controls. The optional
  baseline hash override is for isolated filesystem tests, not re-anchoring a
  production evaluation or resetting authority.
- Execute the exact reviewed conversational adapter inside
  `withExtensionReservation`. The dispatch callback validates returned model,
  completion status and usage, and persists review evidence before returning
  `{ value, usageMicro }`. Do not log headers, keys or arbitrary exceptions.
- Use verified TLS, reject redirects, bound request duration and make one
  dispatch only. A schema-valid but semantically incorrect answer is a retained
  evaluation failure, not grounds for an automatic retry. Uncertain transport,
  invalid usage or evidence persistence failure blocks continuation for review.
- Resolve evidence on the reviewed server path. Arbitrary browser evidence must
  not acquire trusted-source status. A synthetic resolver must be disclosed in
  both the walkthrough and evidence UI.

## Private transport proposal—not started

Air may run a loopback-only review proxy in front of its existing preview. Only
the evaluation conversation path goes through an existing authenticated SSH
local forward to a loopback-only Mini gateway. The key and aggregate ledger stay
on Mini; no production PostgreSQL connection is needed. No public listener,
Tailscale Serve/Funnel, new key/ACL or host-key bypass is part of this route.
Air's first FQDN SSH probe failed host-key verification; an already-approved
authenticated route still needs verification. The gateway and proxy remain
separate from this accounting module and require exact protocol review.

## Verification scope

Five filesystem tests cover the 8+10 allocation, reservation-before-dispatch,
baseline immutability, concurrent exclusion, duplicate identity, reopening after
lost response, sanitized failures, changed baseline, truncated journal and
invalid/excessive usage. They use temporary synthetic files and no network or
model calls. A real gateway, SSH tunnel, held-out model exercise and human
walkthrough are not established by those tests.

## Compatible allocation amendment after the eight-call result

The eight completed held-out results remain unchanged. A separately recorded
`allocation_amended` event (version 2, identity
`conversation-repair-2-interactive-8/v1`) changes only future phase ceilings to
eight held-out, two explicitly labeled repair probes and eight interactive turns.
The aggregate maximum remains eighteen $0.05 reservations. The original baseline
and every prior reservation remain charged against the same $5 authority.

`amendRepairAllocation` holds the same lock and validates the full journal before
appending the event. It refuses an existing amendment, uncertain/failed attempts,
or more than eight already-consumed interactive slots. It does not dispatch a
model. The repair phase has zero capacity before the amendment. New readers
accept original version-1 events plus this version-2 amendment; older readers
fail closed on the new event and must not be used for subsequent dispatch.

Two added tests verify byte-preserving amendment, phase ceilings, aggregate
reservation conservation and refusal to reduce already-consumed allocations.
The repaired protocol and exact two-case manifest still require review before
those probes. This is an explicit repair exercise, not an automatic retry or
an interactive turn relabeled to evade a limit.

## Explicit failed-attempt review

`reviewFailedAttempt` adds a trusted local review operation. It does not inspect
private response bodies, dispatch a model, change the protocol pin or restart a
gateway. Before invoking it, the responsible reviewer must independently verify
provider completion and valid model/usage evidence, establish a response-schema
failure, and review the exact repaired source plus independent repair evidence.
This operation is not available for uncertain transport or unverified usage.
That classification is a caller obligation; the helper cannot establish it from
hashes or the original generic failure code alone.

The version-3 `failed_attempt_reviewed` event contains only the failed request
UUID, SHA-256 of the original failed JSONL line **including its newline**, repaired
source commit and SHA-256, review-evidence SHA-256, timestamp, baseline anchor,
and fixed reason `validated_response_schema_mismatch_repaired`. It accepts no
free-text reason, prompt, answer or other extra fields. Hashes bind the evidence
supplied by the trusted caller; they do not authenticate that caller or prove a
review was correct. Source and evidence hash definitions must be documented by
the reviewer so the exact artifacts can be independently checked.

The helper uses the original exclusive mutex and validates the whole journal
before appending and fsyncing. It refuses a nonexistent, pending, completed or
already-reviewed attempt, a mismatched failure hash, or an unchanged source
commit. Partial/malformed journals and existing locks remain blocking. The
original failed event is never rewritten or converted to success. Its $0.05
reservation and phase slot remain spent. Review appends no refund, reservation
or allocation amendment; a failure cannot be used to change phase ceilings.

Future dispatch requires a **new request UUID** and the reviewed source commit.
The old UUID remains unusable even with a different request/source. Journal
replay enforces ordering: a later review cannot retroactively authorize a
request reserved while a failure was unresolved. A later new failure blocks
again until a separate evidence-linked review; this is not blanket permission
to continue. Older readers fail closed on version-3 events.

Four new synthetic filesystem tests verify retained failure/reservation and the
seven-slot remainder after one failed interactive turn, exact review binding,
same-ID refusal, reviewed-source restriction, phase exhaustion, lock exclusion,
pending/completed refusal, and malformed/duplicate/late-review rejection. All
eleven extension-ledger tests pass under the standard fixture clock, and
TypeScript checking passes. These tests use invented records in temporary
directories. **No actual failed-attempt review event has been recorded by this
implementation slice**, and no real-user response has been read or replayed.
Gateway restart and paid continuation still require their separate reviewed
source and operational handoff.

If stage diagnostics are added later, use a closed set of nonpersonal codes such
as `response_schema_invalid`, `context_validation_failed`,
`usage_evidence_invalid` and `evidence_write_failed`. Never use raw exception
messages or rejected values as codes. This is a proposal only; the present
terminal failure code and existing records remain unchanged.

## Prepared state-contract repair pin

The isolated Mini caller now pins protocol `5534ee609eca7c17e5e6f9df1310647a58641637`. Its seven reviewed files are conversation, chat, planner, workspace, proposal, the Medicaid state registry, and frozen conversational cases. The registry is now included because the supported state enumeration is shared by the wire schema and application validation. Explicit full state names normalize to supported codes without applying changes or inferring other fields. The guided transition fallback asks about benefits changes and dates before assuming premium comparability.

All seven local file bytes match the named Git source. SHA-256 of the UTF-8 `JSON.stringify(sourceHashes)` object in the runtime's listed insertion order, without a trailing newline, is `d15288adc534106ad268ee954a16deda9338b0c15cff4264144fd31657436a1a`. Forty-two focused guru tests with standard fixtures and TypeScript checking pass on Mini. This verifies source and synthetic behavior, not a new real-model answer.

Preparation does not append a real failed-attempt review, create a replacement interactive manifest, start a gateway or dispatch a provider call. The gateway remains stopped pending the separately bound review evidence and operational handoff. Existing private user artifacts remain unread and unchanged.
