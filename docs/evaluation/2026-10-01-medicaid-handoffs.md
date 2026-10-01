# [affinity.] Medicaid handoff source check — October 1, 2026

This is a **synthetic, read-only link audit**, not a completed enrollment journey, patient-use study, or UH pilot approval. It compared the 50 state plus D.C. links in the local [affinity.] tree with the [CMS state Medicaid contact directory](https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip) and requested each configured URL once. The per-state source URLs, HTTP outcomes, and redirect destinations are retained in [the machine-readable run](./2026-10-01-medicaid-handoffs.json).

- Evaluated: 2026-10-01T18:00:48.854Z; CMS directory returned HTTP 200.
- Denominator: 51 configured state/DC handoffs.
- 37 destinations matched the CMS directory enrollment URL after ignoring only `www.` and a trailing slash. 14 differed; **difference does not prove an error**, since a state may have multiple official entry points and some CMS "Enrollment" links lead to renewal-specific pages.
- Direct HTTP probes: 46 returned 2xx, 1 returned non-2xx, and 4 could not be completed from this machine. A 2xx does **not** prove that application or renewal can be completed.
- Evaluated code state: base `efdbcc2d88729618d15cfdcceaa266dba9165934` plus the California link correction in this slice. This run was against the local link inventory, not an observed production click-through.

## Corrected finding

California previously linked the "Apply or renew" action to a renewal-focused "Keep Your Medi-Cal" page. The current [California DHCS Apply for Medi-Cal hub](https://www.dhcs.ca.gov/medi-cal/apply/) explicitly offers both application and online management/renewal through official partners. The local link now points to that hub; the direct probe returned HTTP 200. The CMS directory's enrollment URL still points to the renewal page, so this intentional source difference is retained rather than counted as a broken link.

## Manual-review queue

- The 14 CMS URL differences need semantic review against the respective state program. No automatic replacement is justified by string mismatch alone.
- D.C. returned HTTP 403 to the automated probe. The [D.C. Health Link Medicaid page](https://www.dchealthlink.com/individuals/medicaid) was independently readable through a browser source and points to District Direct for application and renewal; automated 403 is not proof of a broken user link. A human click-through is still needed.
- Alabama, Maine, Montana, and New Jersey failed this machine's direct probe. CMS currently lists those same enrollment URLs. Their real-browser reachability and completion path remain unverified.
- Human review must confirm that the `Apply or renew` button lands on an appropriate action path for all 51, including portals requiring a login. This audit did not submit forms or create accounts.

## Next gate

Run the separately specified 30 **source-paired synthetic profiles**, compare figures with the official Marketplace on the same day, then complete intended-reviewer comprehension and accessibility checks under [the pilot protocol](../PILOT_EVALUATION.md). Do not promote these link-probe counts into a claim of pilot readiness or enrollment success.
