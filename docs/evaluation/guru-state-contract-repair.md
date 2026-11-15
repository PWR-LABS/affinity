# guru state contract and transition fallback

Protocol source: `5534ee609eca7c17e5e6f9df1310647a58641637`. The aggregate SHA-256 of its seven ordered pinned source-file hashes is `d15288adc534106ad268ee954a16deda9338b0c15cff4264144fd31657436a1a`. Mini caller pin `3c57b20106d52f9ef716f35180d7b12ebcd0f76b` selects this protocol explicitly. Source validation includes the state registry used to generate the model's enum.

This report describes independently generated fictional regressions and source/control behavior. It contains no operator request, provider response, personal scenario, private artifact or live-request identifier. Private interactive reviews and their acceptance evidence remain in the authorized private channel.

## State proposals

Previously, the model's JSON schema allowed an arbitrary state string, while app validation allowed at most two characters. A suggestion such as the fictional test value `Oregon` could therefore satisfy the wire schema and fail application parsing.

The state field now uses one registry-derived enum for both app validation and the planner/conversation JSON schema. Model output is constrained to supported postal codes, empty for an explicit unknown/clear, or null for an unchanged field. The shared proposal parser also normalizes explicitly supplied supported full names, case and whitespace. Thus `Oregon` becomes `OR` without inferring any other household information. Unknown codes, cities, ambiguous combinations and unsupported names fail validation. The same parsing applies to both planner and conversational proposals; edits still require confirmation.

## Guided fallback

A fictional employment-transition question mentioning unknown premiums previously selected Compare from that word alone. Its next question asked which people both premium amounts covered, even when neither amount existed.

The transition fallback now starts with benefits-administrator confirmation of whether coverage changes and its end/start dates. It retains unknown terms and amounts. A doctor/network question still selects Coverage; an explicit request to compare costs still selects Compare. Missing premium contributions are requested before asking whether the amounts cover the same people. No benefit offer, eligibility, date or price is inferred.

## Verification

- Full standard-fixture application suite: **326/326**, no skips.
- Focused guru suite: **42/42**, including all supported state-name mappings, shared wire/app enums, invalid-state rejection, pending confirmation, no inferred fields, retained budget order and append-only failed-attempt review.
- Standard TypeScript and optimized Next build pass.
- Four new browser checks pass: full-name normalization and confirmation, useful transition fallback, missing-amount ordering and unknown-state rejection preserving confirmed state.
- The existing nine-turn conversational replay and nine guru browser scenarios pass. These browser responses are mocked; temporary isolated Chrome contexts close afterward.
- This implementation/verification slice makes **zero live provider calls** and does not read or replay real user artifacts.

## Retained failures and private review

The private evaluation ledger now supports an explicit, evidence-bound review of a terminal schema failure. Its original failed terminal record, reservation and used slot remain unchanged. The local review operation binds the exact failed-line hash, repaired source/hash, verification-evidence hash and a fixed reason. It permits future new request IDs against the reviewed source; it never permits the old ID, refunds a reservation, resets the budget or admits an unresolved pending attempt. No browser review endpoint exists.

Synthetic filesystem tests cover wrong bindings, duplicate reviews, pending/completed attempts, malformed journals, concurrency, source mismatch and retained phase limits. Supplied hashes bind evidence; they do not authenticate a reviewer or establish semantic/human acceptance by themselves.

The private preview distinguishes potentially real authorized inputs from synthetic insurer/source evidence. Interactive inputs and provider receipts must remain private and must never become public benchmark fixtures or examples. The public AI gate remains off. The real workflow's review status and remaining allowance are reported privately; source tests and HTTP health alone do not establish successful operator verification or application completion.

## Remaining presentation polish

Two nonblocking display items remain outside this source-contract repair: `GURU-UI-01`, an empty household size needs an explicit unknown label in the context summary; and `GURU-UI-02`, model emphasis/paragraphs need readable formatting instead of literal markdown and collapsed spacing. These are presentation observations, not private interaction examples. They remain open; no additional provider calls are needed to reproduce or fix them.
