# Medicare Part D standalone-plan sweep

Date: 2026-08-05

## Scope

This sweep measures the medication-first [affinity.] shortlist against the loaded June 2026 CMS
Monthly Prescription Drug Plan Formulary and Pharmacy Network Information public-use file
(`2026_20260610.zip`).

The shortlist deliberately includes only standalone Prescription Drug Plans, identified by CMS
`S` contracts and mapped through `PDP_REGION_CODE`. Medicare Advantage drug plans remain available
through the exact-plan checker but are excluded from discovery because their availability is
county-specific.

## Standalone PDP footprint

| Measure | Result |
|---|---:|
| Standalone plan/segment rows | 367 |
| Standalone contracts | 19 |
| Unique formularies | 35 |
| CMS PDP regions represented | 39 of 39 |
| Plan rows per region | 1 minimum, 10 median, 12 maximum |
| Exact drug products (RxCUIs) | 4,702 |
| Unique formulary-product rows | 113,506 |
| Plan-weighted product rows | 1,187,037 |

Of the 4,702 exact product-level RxCUIs, 3,593 (76.41%) appear in at least one standalone
plan in every CMS PDP region. A total of 2,116 are listed by all 367 plan rows. The median exact
product is listed by 345 plan rows, and 2,470 products are listed by at least 331 plan rows.

These are product-level observations. Different strengths and dosage forms of one medication can
have different RxCUIs, tiers, and restrictions.

## Reported utilization-management flags

The following rates use the 1,187,037 plan-weighted product rows as the denominator:

| CMS field | Share marked true |
|---|---:|
| Prior authorization | 27.45% |
| Step therapy | 0.63% |
| Quantity limit | 41.94% |
| At least one of the three flags | 50.79% |

All three source fields are populated for every row in this standalone-plan slice. The individual
rates overlap and should not be added together.

These figures do not measure prescriptions, beneficiaries, denials, utilization, or enrollment.
They count exact plan-product formulary observations in one CMS snapshot.

## Tier distribution

| Tier | Share of listed plan-product rows |
|---|---:|
| 1 | 7.73% |
| 2 | 16.46% |
| 3 | 22.49% |
| 4 | 31.68% |
| 5 | 21.55% |
| 6 | 0.09% |

Tier numbers are plan-specific formulary positions, not prices. They cannot establish the cheapest
plan without premium, deductible, pharmacy-network, negotiated-price, and beneficiary-cost data.

## Live Ohio validation

Production request:

- State: Ohio, CMS PDP region 14
- Product: lithium carbonate 300 mg capsule, RxCUI `197889`
- Plans evaluated: 10
- Plans listing the product: 10
- Tier distribution: five tier 1, five tier 2
- Plans carrying a reported PA, step-therapy, or quantity-limit flag: 0

The test confirms the state-to-region mapping, live production database, medication lookup, and
shortlist response. It does not recommend a plan or predict out-of-pocket cost.

## Go/no-go

**Go for a measured product post.** The defensible story is that a user can start with medications
and compare the standalone Part D formularies available in a state without already knowing a plan
name. The post should use the Ohio lithium check as an interface example and the all-region sweep as
proof of data coverage.

Do not frame the restriction rates as evidence of concealment or misconduct. Medicare Plan Finder
also presents utilization-management restrictions. [affinity.] offers a compact, batch-oriented
view over public CMS fields.

## Limits

- Snapshot date is June 10, 2026. CMS notes that public-use files may differ from current Medicare
  Plan Finder data.
- Employer plans, PACE plans, and suppressed plans are excluded from the CMS public-use file.
- The discovery flow excludes county-specific Medicare Advantage drug plans.
- The loaded monthly file does not support a premium, pharmacy-price, or total-cost ranking.
- Results still require confirmation with Medicare Plan Finder and the plan before enrollment or
  filling a prescription.

## Sources

- [CMS monthly Part D formulary dataset](https://data.cms.gov/provider-summary-by-type-of-service/medicare-part-d-prescribers)
- [CMS 2026 public-use file methodology](https://data.cms.gov/sites/default/files/2025-10/8f1d8b42-bfd1-4f9c-b86d-b92af0c6f3d5/Methodology-PUF-2026.pdf)
- [CMS public-use file agreement](https://data.cms.gov/sites/default/files/2023-10/4eeb19e1-525b-4a4e-9766-b33ff084fc5c/AGREEMENT-FOR-USE.pdf)
- [Medicare Part D plan rules](https://www.medicare.gov/health-drug-plans/part-d/what-drug-plans-cover/plan-rules)

## Reproduction

Counts were computed from `PartDPlan` rows with `contractYear = 2026` and an `S` contract joined to
`PartDFormularyDrug` on `formularyId` and `contractYear`. No beneficiary, claims, enrollment, or
prescription-utilization data were used.
