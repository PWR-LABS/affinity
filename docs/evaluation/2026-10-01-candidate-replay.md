# [affinity.] Outside-In candidate replay — October 1, 2026

Status: deployed, synthetic technical evaluation. **Not** UH pilot approval, a human-use study, an enrollment test, or a security/accessibility certification.

## Evaluated service and sources

- At the start of the replay, the deep `/api/health` response identified production `main` commit `d865ff9ff114386af0c6926711a3f36e726219bc` and reported the app, database, and Marketplace API checks `ok`. The later production response identified `8101955a98e5a326326010652848c87d05c36e15`, which differs from the evaluated code commit only in documentation. Both commits were verified on `origin/main`. The release transition may have occurred during the replay, so the evidence is tied to their identical runtime code, not proof that every request hit one deploy instance.
- The eligibility comparison used direct [CMS Marketplace API](https://developer.cms.gov/marketplace-api/api-spec) responses for federal-platform figures and geography, the [CMS 2026 exchange list](https://www.cms.gov/CCIIO/Resources/Fact-Sheets-and-FAQs/state-marketplaces) for state-exchange classification, and explicitly labeled application safety/validation contracts. These are different evidence bases.
- Synthetic, one-person 2026 profiles only. No UH, patient, or real applicant records were used.

## Results

The [30-case reduced evidence](./2026-10-01-final-live-matrix.json), evaluated at 2026-10-01T20:02:12Z, has **30/30 evaluated, 0 compared-field mismatches, 0 unavailable**. Breakdown: 11 direct-CMS full, 2 direct-CMS ZIP/state geography, 1 direct-CMS multi-county safety, 8 CMS exchange-list, 4 multi-person safety, and 4 input-validation cases. The multi-county case checks that the app declines to invent a first-county estimate.

The [plan-board reduced evidence](./2026-10-01-final-plan-board-pair.json), evaluated at 2026-10-01T20:02:14Z, has **2/2 synthetic profiles, 20/20 first-page plan rows, 0 row/profile mismatches, 0 unavailable**. It compares source ID/name, metal level, gross/net premium, annualized premium, and safely scoped cost-share fields against same-day direct CMS responses. It is not an independent verification of coverage, all plans, or actual annual spending.

The live Medicaid page was also opened after the Ohio contact correction. Selecting Ohio showed the official state site, the `tel:8446406446` link, and a separate renewal caveat. The number is backed by the [Ohio Medicaid renewal form](https://dam.assets.ohio.gov/image/upload/medicaid.ohio.gov/Stakeholders%2C%20Partners/Unwinding/OBWP%20Medicaid%20Renewal%20Form.pdf); the browser observation did not place a call or complete an application.

## What remains outside this replay

- A human must test the official application/renewal action path and phone context for the intended states; earlier audits established entry-page reachability, not completed action.
- Intended reviewers must test comprehension, keyboard and screen-reader use, and mobile use. Existing keyboard/mobile checks are bounded and not a WCAG or usability certification.
- Marketplace API written terms/attribution, 2027 source/routing refresh before 2027 use, and UH Outside-In ownership, COI, security, privacy, accessibility, hosting, support, and research/operations decisions remain open.

Do not use this pass rate to claim enrollment benefit, financial savings, network truth, or authorization for UH deployment or real-data use.
