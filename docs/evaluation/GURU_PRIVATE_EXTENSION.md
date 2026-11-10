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
