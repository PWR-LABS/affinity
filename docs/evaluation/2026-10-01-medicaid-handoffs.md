# [affinity.] Medicaid handoff source check — October 1, 2026

This is a **synthetic, read-only link audit**, not a completed enrollment journey, patient-use study, or UH pilot approval. It compared the 50 state plus D.C. links in the local [affinity.] tree with the [CMS state Medicaid contact directory](https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip) and requested each configured URL once. The per-state source URLs, HTTP outcomes, and redirect destinations are retained in [the machine-readable run](./2026-10-01-medicaid-handoffs.json).

- Evaluated: 2026-10-01T18:00:48.854Z; CMS directory returned HTTP 200.
- Denominator: 51 configured state/DC handoffs.
- 37 destinations matched the CMS directory enrollment URL after ignoring only `www.` and a trailing slash. 14 differed; **difference does not prove an error**, since a state may have multiple official entry points and some CMS "Enrollment" links lead to renewal-specific pages.
- Direct HTTP probes: 46 returned 2xx, 1 returned non-2xx, and 4 could not be completed from this machine. A 2xx does **not** prove that application or renewal can be completed.
- Evaluated code state: base `efdbcc2d88729618d15cfdcceaa266dba9165934` plus the California link correction in this slice. This run was against the local link inventory, not an observed production click-through.

## Corrected finding

California previously linked the "Apply or renew" action to a renewal-focused "Keep Your Medi-Cal" page. The current [California DHCS Apply for Medi-Cal hub](https://www.dhcs.ca.gov/medi-cal/apply/) explicitly offers both application and online management/renewal through official partners. The local link now points to that hub; the direct probe returned HTTP 200. The CMS directory's enrollment URL still points to the renewal page, so this intentional source difference is retained rather than counted as a broken link.

## Browser follow-up (same day)

The five automated-probe exceptions were opened in a normal browser using the configured URLs. All five rendered an official page without bypassing a browser security warning or submitting an application:

| State | Browser observation | Limit |
| --- | --- | --- |
| [Alabama](https://medicaid.alabama.gov/content/3.0_Apply/) | "Apply for Medicaid" page rendered. It lists the Recipient Call Center, **800-362-1504**; the app previously showed the agency's broader **334-242-5000** number. | Did not start an application or call. |
| [Maine](https://apps1.web.maine.gov/benefits/account/login.html) | Redirected to My Maine Connection with an "Apply for Benefits" action and **855-797-4357** help number. | Did not create an account or apply. |
| [Montana](https://apply.mt.gov/) | DPHHS health-coverage application portal rendered; it also describes returning a redetermination packet after a notice. | Did not sign in or submit. |
| [New Jersey](https://www.njhelps.gov/) | NJHelps rendered and named NJ FamilyCare/Medicaid and an application path. | Did not screen or apply. |
| [D.C.](https://www.dchealthlink.com/individuals/medicaid) | DC Health Link's Medicaid page rendered after its normal automatic security check. It links District Direct for application and renewal and lists **202-727-5355** for help with those tasks; the app previously showed DC Health Link's broader **855-532-5465** number. | Did not follow through to District Direct or apply. |

The two verified applicant-help numbers were corrected in code. A browser rendering the destination does not establish a completed handoff, phone reachability, or universal accessibility. The other 49 displayed phone numbers have **not** undergone the same program-specific review.

## Phone-directory comparison (same day)

The repeatable `npm run eval:medicaid-handoffs` audit was extended to capture the telephone numbers shown in each state section of the live CMS directory. The 2026-10-01T19:32:10Z run parsed all 51 state/D.C. sections: **48 app numbers matched a CMS-listed number; 3 differed**. A mismatch is a review signal, not evidence of a bad number. All three exceptions have a state-source explanation:

| State | App number | CMS directory number | State-source interpretation |
| --- | --- | --- | --- |
| Alabama | 800-362-1504 | 334-242-5000 | The [state application page](https://medicaid.alabama.gov/content/3.0_Apply/) lists 800-362-1504 as the Recipient Call Center; CMS labels 334-242-5000 "General Questions." |
| Missouri | 855-373-9994 | 573-751-3425 | The [state application page](https://dss.mo.gov/healthcare/apply) says to use 855-373-9994 to apply by phone; the CMS-listed number is different. |
| New Hampshire | 844-275-3447 | 800-735-2964 | The live [NH EASY portal](https://nheasy.nh.gov/) displays 1-844-ASK-DHHS as its main contact. State [DHHS material](https://www.dhhs.nh.gov/sites/g/files/ehbemt476/files/inline-documents/sonh/small-stakeholder-meeting-02242023.pdf) identifies 800-735-2964 as TDD access rather than the primary voice line. |

This is a **directory agreement check**, not a call test or a full audit of which number handles a particular renewal question. The 48 matching numbers still need program-specific confirmation before a human pilot freeze.

## Remaining manual-review queue

- The 14 CMS URL differences need semantic review against the respective state program. No automatic replacement is justified by string mismatch alone.
- The initial direct probe's D.C. 403 and Alabama/Maine/Montana/New Jersey failures were browser-reachable in the follow-up above. Account creation, action-path completion, and recurring rechecks remain unverified.
- Audit the remaining 49 displayed phone numbers against current program-specific help lines; CMS directory agreement alone does not prove that a particular line handles application or renewal questions.
- Human review must confirm that the official-site button lands on an appropriate application or account path for all 51, including portals requiring a login, and that renewal instructions are findable where relevant. This audit did not submit forms or create accounts.

## Next gate

The [30-case live eligibility matrix](./2026-10-01-pilot-live-matrix.md) has since run with separately labeled direct CMS, official exchange-list, and app-contract evidence. The 14 link differences, 49 unreviewed phones, application/renewal action paths, intended-reviewer comprehension, and accessibility checks remain under [the pilot protocol](../PILOT_EVALUATION.md). Do not promote browser-render counts into a claim of pilot readiness or enrollment success.
