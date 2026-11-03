# [affinity.] — 2027 Marketplace readiness audit

Observed November 3, 2026. Live API observation times below are UTC from the execution host. Public-source publication/update dates remain separate from observation time.

This is the retained pre-implementation audit. The [subsequent development candidate](evaluation/2026-11-03-plan-year-candidate.md) implements year selection and routing and records separate local verification; it has not been deployed.

**Outcome: 2027 source data are available in the bounded sample; consumer support remains NOT ENABLED.** The public eligibility, plan-search, and provider-lookup routes still reject 2027. This audit changes tooling and documentation only. It is not a source-paired 2027 quote replay, independent network verification, or authorization for a pilot or deployment.

## Verified source availability

The [final reduced evidence](evaluation/2026-11-03-plan-year-availability-repeat.json) covers 18:02:05–18:02:15 UTC. The responding production code remained `d2ec33ede083a548670e0fecce7f16b48d786a94` before and after the probes; both deep health checks passed. Runtime source files were unchanged during this audit.

Each profile is a fixed synthetic one-person household. Geography had to resolve to exactly one county; the audit requested eligibility plus the first ten plans, without pagination or disk caching. Availability requires usable expected fields, not just HTTP 200.

| Synthetic case | Requested year | State / ZIP | Source total plans | Sampled rows | Availability |
| --- | --- | --- | ---: | ---: | --- |
| Ohio control | 2026 | OH / 44106 | 119 | 10 | observed |
| Ohio | 2027 | OH / 44106 | 132 | 10 | observed |
| Florida | 2027 | FL / 33101 | 160 | 10 | observed |
| Texas | 2027 | TX / 77002 | 135 | 10 | observed |
| Arkansas | 2027 | AR / 72201 | 35 | 10 | observed |
| Oklahoma | 2027 | OK / 73104 | 81 | 10 | observed |

Result: **5/5 requested-2027 profiles plus 1/1 2026 control**, with usable eligibility and sampled plan fields. The totals describe the source response, not fully examined catalogs. No app-versus-source premium comparison was performed. The API returned no explicit plan-year field in these 60 sampled rows; the requested year is known, but row-level year identity was not independently certified. Some issuer document URLs mention that year, which is only a URL observation.

Four additional CMS probes succeeded: provider autocomplete with `year=2027`, drug autocomplete (a year-independent name lookup), and provider/drug coverage requests for ten sampled Ohio plans with `year=2027`. Each coverage endpoint returned ten rows with status fields. Names, identifiers, raw bodies, and coverage verdicts were not retained in the reduced evidence. Endpoint availability does not verify an actual person's coverage; absent rows remain unknown.

All three deployed 2027 rejection guards returned HTTP 400 with the existing 2026-only message. This confirms the old boundary, not readiness of an enabled 2027 journey.

### Preserved incomplete first run

The [first observation](evaluation/2026-11-03-plan-year-availability.json), 17:59:59–18:00:06 UTC, had **5/6 available profiles**. CMS placed synthetic Oklahoma ZIP 73102 in both county FIPS 40109 and 40027, so the audit made no eligibility or plan request for that case. This is unresolved geography, not evidence that Oklahoma lacks 2027 data. A separate county lookup established that 73104 resolves to 40109; the repeat changed that fixed synthetic input. It also repeated the deep health check at the end rather than only the shallow check. The first run's final `marketplaceApiOk: false` means the shallow check did not observe that dependency; it is not a failed authentication finding. Both run records and their different harness hashes are retained.

## State-routing audit

The primary authority is the [CMS plan-year 2027 marketplace map and text list](https://www.cms.gov/marketplace/in-person-assisters/training-webinars/training/marketplaces-map), observed November 3; its displayed last-modified date is September 1, 2026, 09:18 AM, with timezone unspecified. Its 51 classifications are:

| Platform | Count | State / D.C. codes |
| --- | ---: | --- |
| Federal Marketplace | 27 | AL, AK, AZ, DE, FL, HI, IN, IA, KS, LA, MI, MS, MO, MT, NE, NH, NC, ND, OH, SC, SD, TN, TX, UT, WV, WI, WY |
| State marketplace using the federal platform | 2 | AR, OK |
| State marketplace using its own platform | 22 | CA, CO, CT, DC, GA, ID, IL, KY, ME, MD, MA, MN, NV, NJ, NM, NY, OR, PA, RI, VT, VA, WA |

Compared with the app's 2026 table, the only platform change is **Oregon**. This is a classification comparison for all 51 jurisdictions, not a live API test in all 29 federal-platform states or an application-path audit.

[HealthCare.gov's current state-routing notice](https://www.healthcare.gov/marketplace-in-your-state/) explicitly separates Oregon's 2027 enrollment at ExploreHealthOR.gov from its 2026 HealthCare.gov information. [Oregon's November 2 launch announcement](https://www.oregon.gov/oha/ERD/Pages/Open-Enrollment-begins-as-Oregon-launches-Explore-Health-its-new-marketplace-for-private-health-insurance-11.02.2026.aspx) confirms the transition. Do not add Oregon to the existing year-independent table: that would also change valid 2026 behavior.

The older [CMS exchange directory](https://www.cms.gov/cciio/resources/fact-sheets-and-faqs/state-marketplaces) still labels its main table 2026 and lists Oregon separately as a 2027 transition. Its older table must not silently become the 2027 authority. The annual refresh concerns plan data, eligibility inputs, and routing; the general [API specification](https://developer.cms.gov/marketplace-api/api-spec) does not itself certify availability of a particular year's data.

## Required implementation and acceptance checks

| Change | Relevant source | Acceptance before enabling 2027 |
| --- | --- | --- |
| Introduce explicit supported-year validation and routing by year. Keep the existing default until the enabled journey is validated. | `src/lib/marketplace/states.ts`, the three API routes | All 51 classifications match each year's authority; OR is federal for 2026 and an official state handoff for 2027; AR and OK remain federal-platform. Unknown/noninteger years fail before source access. |
| Pass the chosen year through both eligibility and plan-board routing. | `src/lib/decision/eligibility.ts`, `src/lib/decision/live.ts` | Oregon 2027 never requests a federal eligibility estimate or plans; the 2026 control retains its route. ZIP/state mismatch, multi-county, multi-person and outage handoffs remain safe. |
| Show coverage year explicitly and use income for that coverage year. Echo year in results. Clear old results and selected doctors when year changes. | `src/components/EligibilityCheck.tsx`, `src/components/PlanFinder.tsx`, result types and page copy | Users can identify the year before submitting and in every quote/result. A year change cannot relabel an old result, restore an old response arriving late, or reuse provider suggestions from another year. |
| Include year explicitly in provider autocomplete requests. | `PlanFinder.tsx`, `src/app/api/providers/autocomplete/route.ts` | Network tests observe the same year in autocomplete, eligibility, plan search and provider/drug coverage calls. Drug-name lookup remains year-independent; formulary coverage remains year-specific. |
| Retain current live-source math and unknown handling; refresh year-sensitive reference/evaluation inputs. | `src/lib/decision/premium.ts`, `src/lib/decision/cost-share.ts`, evaluation fixtures | Recalculate annual premium from the displayed monthly figure. Missing premiums and ambiguous cost-share variants stay unknown. Do not reuse the fixture-only 2026 subsidy policy as a 2027 dollar oracle or expose the fuller cost engine as live. |
| Run an exact-candidate 2027 source pair and focused human checks. | source-pair scripts, `docs/PILOT_EVALUATION.md` | Compare displayed eligibility/quote fields with same-day CMS responses for explicit 2027 profiles; retain 2026 regression controls and year-specific state handoffs. Check keyboard/screen-reader year changes and reviewer comprehension. Record source year, exact commit/deploy identity, mismatches and unavailable cases separately. |

The existing API terms, human-use/accessibility and UH governance gates remain open. This audit does not resolve them. Medicare Part D, employer indexes, independent issuer reconciliation and production configuration are outside this slice.

## Reproduce and verify

Use Node 24.22.1 (the repository pin) and the existing local `.env` containing `MARKETPLACE_API_KEY`. The runner uses only fixed synthetic inputs, the official CMS API, and the public deployed guards. Do not put a key in a command argument or committed evidence.

```bash
node --env-file=.env --import tsx scripts/eval-plan-year-availability.ts > /tmp/affinity-plan-year-availability.json
npm run typecheck
npm run eval:production-readiness
```

`eval:plan-year-availability` is also available when the key is already in the environment. Exit zero means the bounded observations completed while 2027 stayed disabled, not that 2027 may be enabled. A different local audit commit is reported separately from the observed production release; a production transition makes the observation incomplete. The retained final evidence's harness SHA-256 matches the script in this slice. Do not overwrite a retained run when repeating it.

Verification for this slice: Node 24.22.1; typecheck; the 12-gate deterministic regression bundle including 123 unit tests and the 31-case fixture preflight; six audit-specific tests within that suite; final live availability/rejection audit; diff whitespace and reduced-evidence secret checks. No browser windows were opened.

**Next executable slice:** implement the year-aware routing helper and its 2026/2027 regression cases, while the public default remains 2026. Then connect explicit year selection and repeat source pairing before enabling 2027.
