# Conversational guru repair probes — November 9, 2026

Both explicitly named repair probes completed at 04:17 UTC on November 10 (November 9 Eastern), using Terra and protocol `8ed7bf5549703f3950fc7627b11ab7cb128d138f`. The frozen inputs and expectations are unchanged from the original eight-case exercise. These are targeted post-repair probes, not a new held-out benchmark. See the [synthetic responses and usage](2026-11-09-guru-conversation-repair.json).

| Original finding | Repair observation | Assessment |
| --- | --- | --- |
| Household offer omitted from proposed changes | Proposes `employerOffer: offered_household`, describes it as pending confirmation, retains official Marketplace and Medicaid review, and asks household size | Structured check passes; assistant review supports repair of this specific omission |
| Doctor follow-up remains on Compare and omits name | Routes to Coverage and proposes `doctorQuery: Dr Morgan Sample`, asks for the plan, and distinguishes premium comparison from network fit | Structured check passes; assistant review supports repair of this specific routing/proposal failure |

Neither response claims a completed application edit or invents an identifier. The first reply still uses a fairly procedural confirmation sentence; an interactive walkthrough must assess whether the flow feels conversational. This review was performed by the implementing assistant, not an independent blinded human reviewer.

The original eight responses and their failures remain unchanged in the [held-out report](2026-11-09-guru-conversation-heldout.md). In particular, the household-size premature completed-edit claim has a regression test and a narrow runtime phrase guard, but was not a third paid repair probe. No comprehensive semantic guarantee, population accuracy, human acceptance or production readiness is established.

## Retained aggregate accounting

- Original baseline SHA-256: `72b1c403baaf9222616652d930a7aeef29f216460eaf7ddfd5f613cae413608e`, unchanged.
- Original reservations: $4.054254; eight conversational reservations: $0.400000; two explicit repair reservations: $0.100000.
- Aggregate reserved: **$4.554254 of the same approved $5.000000**. Remaining headroom: **$0.445746**.
- The append-only amendment `conversation-repair-2-interactive-8/v1` leaves **eight interactive requests**, at $0.05 reserved per request. No interactive request has yet been dispatched.
- Repair usage estimate: **$0.005374**; baseline plus eight conversations plus these repairs: **$0.299775**. These conservative estimates are not invoices and do not release reservations.
- Journal: ten extension reservations, ten completions and one allocation amendment; no retries, failed transports, refunds or reset.

The execution manifest is `68b4a3ab7e2cb7e1940e76faf6fa71730af81a2a990bd710ce09f2915a26eaf8`; it records the six exact protocol file hashes and both serialized request hashes. Local provider receipts remain private. Public AI, recurring allowance, voice and deployment remain separate gates.

## Mini review surface verification

The Mini assembled UI checkpoint `399a07343485004ddeda200f303d0fad991f7d0e` with the separately pinned repaired protocol and accounting amendment in its isolated review checkout. Loopback app, proxy and model gateway HTTP checks passed. The disclosure page and fictional name endpoint returned 200. A real headless Chrome exercise passed the guided conversation, confirmation, name selection, sourced follow-up, changed-household supersession and cross-tab context paths, including the 390px width check. Its nine model turns and source responses were mocked: **zero additional paid requests**. The temporary browser closed after verification. Eighteen focused unit tests and TypeScript checking passed. The default bundled Chromium was unavailable; the existing installed Chrome was used without installing a browser.

The gateway fixture-clock failure was repaired in Air source `8df2be63ecf835f8d78718e2dfb9fe0b996a6355` and integrated on Mini. A trusted test-only constructor clock avoids the suite’s November 3 fixture date; no browser clock input is accepted, and the runtime uses actual wall time with its original price-expiry gate. The first full-suite attempt could not resolve the isolated checkout’s nested `stream-json` dependency (261 passed, ten files failed to load). Reusing the already-installed primary ingestion dependencies through `NODE_PATH`, without installing anything, resolved those load failures. The complete standard-fixture suite then passed **318/318**. The owned gateway was restarted with the reviewed source; its protocol pin and accounting manifest remain unchanged. A fresh browser opened the disclosure and initial workspace with connected mode off, consuming no paid request.

The live review address is Mini-local `http://127.0.0.1:3013/review`; Air SSH authentication remains unavailable. Current process identities and free-space observations belong to the private handoff, not a durable availability claim. Listeners are deliberately retained for the requested review; no public deployment, human walkthrough or Air-connected availability is claimed.
