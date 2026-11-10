# guru agent scope and evaluation

Working implementation scope, November 8, 2026 Eastern. This records the operator's requested direction; it does not change the public product doctrine or claim a model winner, deployment, institutional approval or live voice support.

## Intended outcome

Help someone choose a feasible insurance path and understand exact plan evidence. Primary navigation: **guru / Discover / Coverage / Compare / How**. guru is the conversational entry point, with a conversation pane alongside editable context, source-backed results and next actions. Discover is its first workflow. Structured forms remain available independently of chat or its budget.

The operator requested live AI with a capped budget, then comparison of **gpt-6.1-sol**, **gpt-6.1-terra**, and **gpt-6-luna** across the app's functions before completing the website updates. A one-time benchmark budget and the recurring public allowance are distinct decisions. On November 9 Eastern, the operator approved the one-time $5 benchmark cap. Mini Chief provisioned the dedicated restricted credential; the Mini verified its protected local presence before execution. No secret belongs in this document, a benchmark artifact or Git.

## Architecture to evaluate

One request coordinator owns a bounded interaction. It invokes allowlisted application tools, validates their results and returns a typed UI response. It does not need an autonomous swarm, a new worker service, a vector database or an always-running cloud agent. Different functions may ultimately use different models, but every transition remains inside the same spend reservation and tool authority boundary.

| Function | Model contribution | Application responsibility and acceptance |
| --- | --- | --- |
| Discover | Clarify goals, household members, employment/offer distinctions and missing information | Explicit inputs; year/state routing; supported official screening; never final eligibility from prose |
| Employer search | Interpret name and location, ask disambiguating questions | Exact employer/EIN lookup; employer identity never substitutes for actual benefit option |
| Coverage | Select provider/drug tools and explain source findings | Identifier validation, exact plan/year, dated evidence, source conflicts and unknown membership |
| Medicaid | Explain available state navigation and next steps | Current official links; special categories and unsupported estimates retain official handoff |
| Medicare | Guide Part D identity/formulary checks | Current scope is drug evidence; no inferred medical network or complete Medicare comparison |
| Compare | Explain tradeoffs and ask for missing benefit values | Deterministic arithmetic, separate premiums from care scenarios, source-derived assumptions; preserve actual limitations of live ranking |
| Benefit extraction | Propose fields from supplied documents | Field-level provenance, tier and pay-frequency checks, missing fields null, user confirmation before adoption |
| How | Short contextual explanations and task links | Replayable three-step walkthrough and direct form destinations |
| Conversation | Follow-up questions, revisions, plain-language summaries | Shared structured state; explicit user corrections invalidate incompatible prior results |
| Source review | Summarize diagnostics and candidate identity matches for an operator | Mini publisher and all validation gates stay authoritative; model cannot publish, change mappings or accept partial sources |
| Reliability and privacy | Explain unavailable tools and model limits honestly | Durable budget reservation, retries/idempotency, bounded inputs/output, no transcript in spend ledger, accurate model-transfer disclosure |
| Voice | Optional spoken interface to the same tools and context | Separate speech budget, consent/mic controls, transcription confirmation for names/IDs/numbers, interruption/cancel tests |

Health checks, freshness calculations, ranking arithmetic, budget accounting, refresh scheduling, publication and retention do not need LLM execution. Their explanations can be evaluated; their authority does not move into a model prompt.

## Three-model comparison

Official model/pricing pages were inspected November 9 UTC. Standard short-context text rates, USD per million tokens:

| Model | Input | Output | Evaluation hypothesis—not a measured result |
| --- | ---: | ---: | --- |
| gpt-6.1-sol | 2.00 | 10.00 | Candidate for complex, conflicting evidence and difficult multi-step cases |
| gpt-6.1-terra | 1.00 | 5.00 | Candidate for the default conversational workflow |
| gpt-6-luna | 0.10 | 0.50 | Candidate for focused routing, extraction and concise explanations |

Sources: [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [pricing](https://developers.openai.com/api/docs/pricing). No model wins by price or published positioning alone. All three models responded during the approved benchmark. Requested aliases and returned model IDs are retained in the local ledger; aliases can change over time.

### First-stage executable benchmark

`scripts/eval-guru-models.ts` contains a dry-by-default synthetic benchmark. The corpus is `scripts/guru-benchmark/cases.ts`; it includes 38 cases across 13 families, with 28 evidence/response cases and 10 function-selection cases. Every model sees identical inputs, output schema/tools, low reasoning effort and 1,600 maximum output tokens. Two repetitions give 228 requests, with model order rotated across cases and repetitions. Gold fields and review rubrics are excluded from model requests.

The case set covers employment vs offer, family-offer ambiguity, state/household limitations, loss of coverage, employer ambiguity/empty search, provider absence/positive/conflicting/stale evidence, Medicaid limitations, Medicare scope/restrictions, premiums vs total cost, 24 vs 26 pay periods, scenario uncertainty, missing/extracted benefit fields, How, privacy, document prompt injection, fabricated citations, corrected state/year, unavailable chat, reference closure and unchanged source dates. Selection cases map to all ten user-facing search/screen/compare/verification API capabilities. Operational health/freshness routes remain deterministic.

Automated checks assess schema, selected tool, exact arguments, source-ID integrity, expected structured fields, completion status and usage accounting. They do **not** establish that free prose is correct. A blinded review file requires a separate assessment of factual correctness, evidence faithfulness, useful next step, clarity and critical failure. Examples of critical failure: unsupported eligibility, fabricated source/price, absent provider promoted to covered or excluded, wrong plan/year, privacy leakage, or a side effect outside authority. A model with a critical failure cannot be selected for that function based on a favorable average.

Report per-model and per-function counts, failures, conservative token cost, whole-response median/p95 latency and raw reviewable answers. Do not call whole-response latency time-to-first-token or time-to-first-audio. With two repeats this is a screening benchmark, not statistical proof of clinical or population-level reliability.

### Following stages required before a production winner

1. Resolve first-stage failures without tuning to hide them. Preserve the original baseline; use a separate held-out set for revised prompts.
2. Integrate actual adapters against deterministic fixture services. Exercise missing inputs, tool failures, state corrections, multi-turn memory and malformed returns end to end. First-stage function selection does not prove live tool execution.
3. Test real browser interactions and accessibility on narrow and wide layouts. Test the actual production budget ledger with simultaneous reservations, restarts, timeouts and cap exhaustion.
4. Evaluate document image/OCR and voice separately if included. Pasted-text extraction does not prove image extraction; text-model scores do not prove spoken entity recognition.
5. Select the least expensive model that passes the required function gates. Any escalation is an explicit bounded policy, not unrestricted retries or model calls until an answer looks good. If none pass, retain the structured workflow and unresolved gate.

## Spending and execution

Recommended public pilot remains $10/month plus $1/day, pending operator selection. The separately approved benchmark has a one-time cap of $5. Its two-repeat conservative reservation total is $4.054254; one repeat is $2.027127. These are preflight allowances, not charges or measured usage.

Dry run (no credential, network or database required):

```sh
node --import tsx scripts/eval-guru-models.ts
```

Only after the operator approves the one-time cap and a dedicated credential is securely available:

```sh
node --use-system-ca --env-file=.env.local --import tsx scripts/eval-guru-models.ts --live --cap-usd=5
```

The command has no implicit API-key fallback and no model substitution. Its fixed local pilot ledger lives under ignored `tmp/guru-benchmark/pilot-v1/`. It reserves before dispatch, persists with fsync, serializes runs, retains the full reservation even after successful lower usage, and stops on ambiguous transport/local failures. It never resets a budget or silently retries. A surviving lock or uncertain row requires review; do not delete it to rerun. Rate configuration expires after seven days pending source review. Returned usage is checked against reservations. Reservations also cover the published 1.25x input rate for 30-minute cache writes; extended cache retention is not requested. Usage-based costs use that conservative rate and are estimates, not provider invoice totals. Cache savings are deliberately not assumed.

This local serialized benchmark ledger is **not** the production multi-instance spending gate. Production needs transactional shared reservations, rate limits and bounded retention in the existing database, with current capacity verified before enabling. No new Render service or allocation is proposed. The approved benchmark makes paid synthetic requests; it does not authorize a database migration, public model activation or recurring allowance.

## Voice answer

Live AI in the current scope means responsive **text conversation**. The three requested models support text/image inputs and text outputs; they are not direct audio models. Voice can wrap the chosen reasoning model.

- A chained mode transcribes a bounded push-to-talk recording, passes confirmed text through the same agent, then optionally reads the answer aloud. It is easier to review exact medication names, plan identifiers and numbers, and easier to meter per turn.
- A conversational voice mode uses a dedicated voice session with a backend agent. It supports a more fluid experience but adds session-duration costs, interruptions and session lifecycle testing. GPT-Live's documented voice-session price is $0.05/minute, with backend model/tool usage additional: a ten-minute session adds $0.50 before reasoning costs. That consumes a materially different share of a $10 pilot than text.

Sources: [audio workflows](https://developers.openai.com/api/docs/guides/audio), [voice session architecture](https://developers.openai.com/api/docs/guides/live), [pricing](https://developers.openai.com/api/docs/pricing). Recommendation for evaluation: text baseline first, bounded push-to-talk as the next modality; full conversational voice remains a separately budgeted option. No microphone control or paid voice service is enabled by this scope.

## Website sequence after agent evaluation

1. guru entry and shared Discover state: responsive split panes, corrected context, missing-input questions, visible evidence and direct task actions. No fabricated chat when the provider is unavailable.
2. Discover form: employer/family offer, current coverage and goals; support unknown/skip; preserve existing screening and official handoffs.
3. Coverage: consistent source/date/unknown language across employer, Marketplace, Medicaid navigation and Medicare drug scope; clearer employer identity disambiguation.
4. Compare: make existing live capability explicit, collect confirmed employer benefit costs and pay frequency, then add deterministic comparisons with assumptions visible. Do not pass off the fixture cost engine as current live ranking.
5. How: replayable three-step walkthrough and task reference with direct destinations, inspired by the inspected [ribosome.] interaction pattern.

Institutional support would be most useful for dependable source access, expert review and participant testing, accessibility/voice evaluation, and a sustainable public usage allowance. Model spending alone does not resolve data gaps or establish eligibility/coverage correctness. No partnership or institutional commitment is implied.

## Current verification

- The approved one-time run completed 228/228 requests on November 9 Eastern / November 10 UTC; conservative usage estimate $0.274661, retained reservation $4.054254, approved cap $5.
- All 60 conceptual tool selections passed. All 168 prose answers received assistant review; independent blinded human review remains pending.
- Terra is the candidate for the next integration stage, not an established production winner. Two Luna structured coverage contradictions remain open integration findings.
- [Measured report](evaluation/2026-11-09-guru-model-benchmark.md) and [full synthetic results](evaluation/2026-11-09-guru-model-benchmark.json) preserve original scores, responses, per-function findings and limitations.
- Six focused harness tests pass. The earlier repository TypeScript check passed; report publication changes documentation only.
- Air owns guru/UI implementation. The old Mini navigation draft is excluded from this benchmark checkpoint. Actual adapter execution, browser acceptance and production spending controls remain separate work.
- The public recurring cap and voice spending remain unapproved. No production activation or deployment occurred.
