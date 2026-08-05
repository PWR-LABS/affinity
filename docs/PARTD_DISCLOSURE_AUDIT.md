# Medicare Part D utilization-management disclosure audit

Date: 2026-08-05

## Finding

An earlier [affinity.] changelog entry described prior authorization, step therapy, and quantity-limit
fields as information that "official tools hide." That wording was too broad and mixed two different
federal products:

- The HealthCare.gov Marketplace API is an ACA-plan developer API. Its published `DrugCoverage` schema
  reports the drug, plan, coverage status, and generic equivalent, but does not specify Medicare Part D
  utilization-management fields.
- Medicare Plan Finder is the consumer comparison tool for Medicare Advantage and Part D. CMS training
  materials explicitly describe displaying tier, formulary status, prior authorization, step therapy,
  and quantity-limit restrictions.
- The CMS Part D monthly public-use file directly publishes tier, prior-authorization, step-therapy, and
  quantity-limit fields for exact drug products.

The defensible [affinity.] claim is therefore narrower: [affinity.] reads those CMS Part D fields directly
and presents them alongside a batch medication check. This is a compact alternative interface over public
CMS data, not evidence that Medicare.gov suppresses the restrictions.

## What the local snapshot measures

The loaded June 2026 CMS snapshot contains:

| Measure | Count | Share |
|---|---:|---:|
| Unique formulary-drug rows | 1,124,586 | 100% |
| Unique rows with prior authorization | 319,047 | 28.37% |
| Plan-by-drug pairs after expanding shared formularies | 19,160,594 | 100% |
| Plan-by-drug pairs with prior authorization | 5,331,897 | 27.83% |
| Plan-by-drug pairs with step therapy | 142,877 | 0.75% |
| Plan-by-drug pairs with a quantity limit | 7,711,110 | 40.24% |

The 27.83% figure means that slightly more than one in four exact plan-by-drug formulary pairs in this
snapshot is marked as requiring prior authorization. It does **not** mean that 27.83% of prescriptions,
beneficiaries, fills, or unique active ingredients require prior authorization. The calculation is not
weighted by enrollment or utilization, and different strengths or forms of the same medication may have
different restrictions.

## Durable external record

- [CMS Marketplace API specification](https://developer.cms.gov/public-apis/documentation/marketplace-api)
  defines the ACA `DrugCoverage` response and does not define Part D utilization-management fields.
- [CMS Part D formulary file description](https://www.cms.gov/research-statistics-data-and-systems/files-for-order/nonidentifiabledatafiles/prescriptiondrugplanformularypharmacynetworkandpricinginformationfiles)
  states that the formulary data include tier, step-therapy, quantity-limit, and prior-authorization
  indicators.
- [CMS Medicare Plan Finder training](https://www.cms.gov/outreach-and-education/training/cmsnationaltrainingprogram/downloads/2013medicareplanfindertipsheet.pdf)
  describes viewing tier, formulary status, and utilization-management restrictions in Plan Finder.
- [Medicare drug-plan rules](https://www.medicare.gov/health-drug-plans/part-d/what-drug-plans-cover/plan-rules)
  explains prior authorization, step therapy, quantity limits, and the exception process.
- [GAO-14-143](https://www.gao.gov/products/gao-14-143) documents CMS oversight of Plan Finder pricing
  accuracy and historical plan suppression for incomplete or potentially inaccurate pricing data. It
  does not establish that Plan Finder conceals prior-authorization flags.

## Reproduction

Counts were computed from `PartDPlan` joined to `PartDFormularyDrug` by `formularyId` and `contractYear`.
No beneficiary, claim, prescription, or enrollment data were used.
