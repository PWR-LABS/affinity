# [affinity.] — CMS cloud source access, November 3, 2026

## Diagnosis

[Issue #4](https://github.com/PWR-LABS/affinity/issues/4) remained open after the
content review because GitHub's runner received HTTP 403 for the CMS New York
guide, policy-publication index and state-contact directory. Local reachability
was insufficient proof of cloud operation.

The [bounded cloud diagnostic](https://github.com/PWR-LABS/affinity/actions/runs/41733685349)
at commit `5f3dac604ab003837d4891cc87f85a08cffbb59e` compared four transports for
each of those three URLs. All default Node requests returned 403; all nine
identified Node/curl requests returned 200 with main content. Adding the honest
`affinity-source-watch/1.0 (+https://github.com/PWR-LABS/affinity)` identity was
sufficient; omitting `cache: no-store` or changing transport was unnecessary.
This is an observed request-dependent difference, not a claim about CMS's
undisclosed filtering rules.

The diagnostic's raw `accessDenied` substring flag also matched the successful
New York guide. It is only a text heuristic, not an access verdict. The production
watcher's HTTP status, main-content parser and normalized fingerprint determine
whether a usable observation was actually obtained. Raw response bodies and
credentials are not retained in diagnostic artifacts.

## Repair and constraints

The header applies only to `www.medicaid.gov` and `www.cms.gov`. A local control
found that NYC's PDF returned 403 with this identity and 200 with its original
request, so non-CMS requests retain their existing headers. All source requests
are sequential and wait 1.2 seconds after the prior request completes, respecting
the one-second delay in [Medicaid.gov robots.txt](https://www.medicaid.gov/robots.txt).
There is no retry loop, proxy, credential change or browser impersonation.

The fix does not change source URLs, baseline hashes, fingerprint format, policy
text, review date or the 30-day review window. A later HTTP/network/parse failure,
changed fingerprint or expired review still raises the review condition.

## Verification

The local production watcher returned seven HTTP 200, `unchanged_observation`
records, `needsReview: false` and `reviewOverdue: false`. All 151 tests, 13 readiness gates and
typecheck passed. The added regression checks enforce CMS-specific identity,
request sequencing and a one-second minimum delay, and verify that HTTP 403
remains an unhashable review condition.

The [cloud candidate run](https://github.com/PWR-LABS/affinity/actions/runs/41734238715)
at commit `3d0bd88` passed all 151 tests, typecheck and an explicit all-seven-source
assertion. Its [source report](2026-11-03-guidance-cloud-candidate.json), observed
at 22:51:40 UTC, has seven matching HTTP 200 observations and no review condition.
The temporary branch-only diagnostic job was removed before merge; production
job permissions, issue ownership checks and publication gates remain unchanged.
The normal main-branch run must independently verify resolution and close the
existing issue through its established reporter.
A manually dispatched run does not establish a future scheduled cron execution
or automatic catalog renewal.
