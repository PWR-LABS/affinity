# Conversational guru held-out exercise — November 9, 2026

Eight frozen synthetic requests completed against protocol `56e180a5ccd96308b74072937d1ef84666b754fd`, using Terra and the exact `conversationBody` / `conversationTurn` functions. The private harness checkpoint before execution was `6b33d06`. This exercise adds conversational history, current evidence and explicit context proposals to the earlier one-turn benchmark; it is not a browser or human walkthrough acceptance.

**Six of eight passed the frozen structured checks. The conversational acceptance gate remains open.** Assistant review found omitted explicit edit proposals, the wrong next workflow in a doctor follow-up, and a premature completed-edit claim. No retries or prompt-tuned reruns occurred. All original responses, token usage and findings are retained in the [machine-readable companion](2026-11-09-guru-conversation-heldout.json).

| Case | Structured check | Assistant semantic finding |
| --- | --- | --- |
| First missing question | Pass | Asks one ZIP question; rubric preferred state first. No invented facts. |
| Working does not establish offer | Pass | Proposes working only, leaves offer unknown and asks before a screening action. Application must preserve offer handoff. |
| Spouse household offer | Fail | Asks permission again and omits the explicitly supplied offer from the proposal. Preserves possible Medicaid review. |
| Premium explanation | Pass | Correct $2,600 vs $2,400 annual premiums and $200 difference; cites evidence and preserves unknown total care costs. Reasks already-entered pay frequency. |
| Natural doctor follow-up | Fail | Stays on Compare and omits the requested doctor search name, asking for confirmation before generating the proposal. No invented identifier. |
| Dated fictional listing | Pass | Explicitly distinguishes synthetic evidence from real future-year coverage; asks exact benefit option. |
| Same-input source correction | Pass | Current conflict becomes unknown; does not reaffirm the stale positive or infer exclusion. |
| Household correction | Pass | **Workflow failure:** says “Updated your household size to 2; nothing else changed” before confirmation/application. The application also resets the people basis when household size changes. |

The explicit-change failures suggest the model is confusing proposing a change with obtaining application confirmation. The prompt should request the proposal immediately when the user explicitly supplies a correction, describe it as pending, and leave the actual approval/apply step to the UI. It must not say a change was applied without a corresponding application receipt. Source-grounded prose alone does not establish successful context handling.

The household-correction finding remains open despite its structured pass. This assistant review is not independent blinded human review. The eight cases are a small hand-authored screening set, not population-level reliability or clinical validation. No live insurer evidence, actual eligibility calculation, enrollment, or production database was used. No injection-specific held-out request is included in this eight-case corpus; earlier synthetic injection results do not cover every conversational attack.

## Cost and authority

- Original immutable baseline reservation: **$4.054254**.
- Eight extension reservations: **$0.400000**, retained regardless of cheaper usage.
- Combined reservation: **$4.454254** of the existing approved **$5.000000** cap.
- Remaining reservation headroom: **$0.545746**, supporting at most **ten interactive requests** at $0.05 each under the current phase limits.
- This exercise's conservative usage estimate: **$0.019740**, calculated from returned input/output usage with the reviewed 1.25× input allowance. Original plus extension usage estimate: **$0.294401**. These are not invoice totals.

All eight completed with valid model/usage evidence; there were no transport retries or reservation releases. The original ledger SHA-256 remains `72b1c403baaf9222616652d930a7aeef29f216460eaf7ddfd5f613cae413608e`. The extension journal contains eight reservations and eight terminal completions. Semantic failures remain in the result report; they do not trigger automatic additional calls.

## Prepared private gateway

`private-gateway.ts` accepts the ordinary `{id,history,context,evidenceActions}` request at `/api/guru`, restricted to the Air review proxy origin `http://127.0.0.1:3013`. Its launcher binds only Mini `127.0.0.1:3127`. Phase, model, source commit and manifest are server-controlled. Client-supplied evidence/phase/extra fields are rejected. Returned evidence is explicitly marked synthetic and keyed to current request inputs; premium evidence is deterministic arithmetic on declared amounts. Other fixtures remain unknown, without invented provider membership or quotes.

This prepares a transport for the private walkthrough; it does **not** establish that the gateway, SSH tunnel or review UI is running. No Mini-local UI is installed by this module. The launcher checks its pinned source; repairing the protocol requires explicit source re-review and updating that pin, not silently importing later code. It must remain stopped while the above workflow failures are being repaired. The current ten interactive slots are preserved for the reviewed walkthrough.

Twenty-one relevant tests pass, including conversation/source supersession, shared extension accounting, origin/client-evidence rejection, synthetic evidence binding and request cost limits. TypeScript checking passes. The tests do not make paid model calls. Public AI remains off; recurring allowance, voice and deployment remain separate decisions.
