# [affinity.] keyboard and responsive plan-search check — October 1, 2026

This is a bounded operator browser check with a synthetic one-person Ohio profile (ZIP 44106, age 50, $45,000 annual household income), not a participant study, screen-reader test, or WCAG conformance audit. No UH or patient records were entered.

## Reproduced defect and correction

On the prior live revision, pressing Enter on the focused **Find my plans** button disabled that button during the request. Browser focus fell to the page and remained there after results loaded. The whole result section was also an `aria-live` region containing the plan list, so its announcement scope was unnecessarily large.

Code commit `ee61e71977d7adaafb571f917a1712e202faa1a3` keeps the button focusable while loading, uses an in-flight guard to reject repeat submissions, and updates a persistent, concise status message when results arrive. The large plan list is no longer a live region. This changes interaction behavior, not the quote or eligibility calculation.

## Live retest

At 2026-10-01T19:21:30Z, the public deep-health response reported this exact commit on `main`, with app, database, and Marketplace API checks `ok` and the API key `present`. On the deployed plan page:

- The skip link was first in keyboard order; activating it made the ZIP field the next Tab stop.
- ZIP, age, income, household size, medication search, selected-medication removal, and submit were keyboard reachable. Typing `metformin` exposed strength-specific suggestions, and Enter selected the first suggestion.
- During a fresh submit, focus remained on **Finding your plans…**; after the response, focus remained on **Find my plans**. The accessibility tree contained a concise `119 Marketplace plans in Cuyahoga County, OH are ready below` status, followed by a separately labeled result region. Tab advanced into the results' first link.
- At a 390 × 844 mobile viewport, the form, uncertainty note, and first plan rows were visibly readable without observed clipping or overlap. Document width was 380 px against a 390 px viewport—no horizontal overflow in this checked state. The temporary viewport override was reset and the agent-opened tab closed.

The production build, typecheck, and 12-gate readiness bundle passed before the push. This browser check did **not** run VoiceOver or another screen reader, verify every keyboard state or breakpoint, or establish human comprehension. Those remain part of the proposed evaluation protocol.
