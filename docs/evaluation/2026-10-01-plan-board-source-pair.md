# [affinity.] live plan-board source pair — October 1, 2026

Two prewritten, synthetic one-person 2026 profiles were sent to the live [affinity.] plan board and separately queried against the [CMS Marketplace API](https://developer.cms.gov/marketplace-api/api-spec). The [reduced case record](./2026-10-01-plan-board-source-pair.json), completed at 2026-10-01T18:35:21.927Z, retains no API key, keyed URL, raw source body, or real person-level information.

| Profile | Source plan total | Source APTC / month | First-page plan rows compared | Field differences |
| --- | ---: | ---: | ---: | ---: |
| Ohio, synthetic subsidized adult | 119 | $324 | 10 | 0 |
| Wisconsin, synthetic no-subsidy adult | 48 | $0 | 10 | 0 |

Both profile-level comparisons matched state, county, rounded monthly APTC, and plan total. All **20/20 sampled plan IDs** appeared in the app response, with no compared-field difference in name, metal level, rounded gross monthly premium, estimated net monthly premium, twelve-month net premium, deductible, or in-network out-of-pocket maximum. A separate recomputation found annual premium equal to twelve times displayed net monthly premium for all 20. Source records supplied gross premium, deductible, and out-of-pocket maximum for all 20; each sampled deductible and maximum had only one cost-share candidate, so this run did not probe competing CSR/tier variants.

This is a **same-feed transformation and live-plumbing check**. It does not independently verify CMS or issuer price accuracy. The 20 rows are the first source page for each profile, not all 119 Ohio and 48 Wisconsin plan offerings. The comparison applied the app's documented cost-share selection policy to the direct source record, so matching that policy is not independent proof it chooses the right variant when multiple variants exist. No provider/drug coverage flags, plan-document links, enrollment, total annual care cost, intended-reviewer comprehension, or accessibility were checked.

The live app returned successfully, but the public health route does not expose a build commit and no Render workspace was selected for deploy metadata in this check. The exact live deploy SHA therefore remains **unverified** in the machine record. That provenance gap must be closed before using this as a frozen pilot candidate. A local commit, push, or healthy endpoint is not deploy proof.

Reproduce with a local `MARKETPLACE_API_KEY` in the environment and `npm run eval:plan-board-pair -- --output <new-json-path>`. The script refuses to overwrite an existing run and reduces the direct source response to the two synthetic profiles and first ten plan rows each.
