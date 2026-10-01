# [affinity.] 2026 Marketplace platform parity — October 1, 2026

The [CMS 2026 State-based Exchanges list](https://www.cms.gov/CCIIO/Resources/Fact-Sheets-and-FAQs/state-marketplaces) identifies **21** exchanges operating their own eligibility/enrollment platform and **3** state-based exchanges using the federal platform (Arkansas, Oregon, Oklahoma). [Get Covered Illinois](https://getcovered.illinois.gov/) is Illinois's own enrollment and subsidy service for 2026.

Before this correction, [affinity.] had 20 full-platform states and omitted Illinois. The eligibility flow would therefore attempt a federal Marketplace estimate for an Illinois ZIP instead of providing the state-exchange handoff. That is a route-safety defect; an API response or fixture pass would not make the federal route appropriate.

The 2026 table now includes Illinois → Get Covered Illinois. A parity test compares the route for **all 50 states plus D.C.** with CMS's 21-code full-platform list and explicitly keeps Arkansas, Oregon, and Oklahoma on the federal-platform side. The 30-case synthetic preflight now includes an Illinois state-exchange handoff, requiring no invented subsidy or Medicaid determination.

This is a **2026 plan-year correction**, not a future-year certification. CMS also lists Oregon as seeking to move to its own platform for 2027. The public [affinity.] comparison presently requests 2026 only; any 2027 enablement must recheck platform status, route by plan year, and verify official URLs before release. No UH or patient data was used in this check.
