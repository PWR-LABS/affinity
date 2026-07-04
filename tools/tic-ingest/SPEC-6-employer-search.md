# SPEC-6 — employer-name search wired into /verify (app slice + real DOL data)

Two parts. Part 1 touches the Next.js app — follow the existing patterns EXACTLY as referenced; the
doctrine constraint is at the bottom. Part 2 produces the real dataset with the SPEC-4 tool.

## Part 1 — app wiring (repo root, not this tools dir)

1. **Prisma model** (append to `prisma/schema.prisma`, mirroring the Tic* style):
   ```prisma
   /// Employer-name → EIN lookup rows from public DOL Form 5500 filings (SPEC-4 output).
   model EmployerEin {
     id           String @id @default(cuid())
     ein          String
     name         String
     nameNorm     String
     state        String?
     planName     String?
     participants Int?
     planYear     Int?
     @@unique([ein, nameNorm])
     @@index([nameNorm])
     @@index([state])
   }
   ```
   Create the migration with `npx prisma migrate dev --name employer-ein` (needs local `DATABASE_URL`,
   see `.env.example`), and `npx prisma generate`.
2. **Loader** `scripts/employers-load.ts` (+ package.json script `employers:load`): stream an
   `employers.ndjson` (SPEC-4 output shape) → batched `createMany skipDuplicates` (5k), wipe-and-reload
   semantics like `scripts/tic-load.ts` (copy its structure; pure line-parsing helpers go in
   `src/lib/tic/ingest.ts` with unit tests in `tests/`).
3. **Search route** `src/app/api/employers/search/route.ts` — copy the shape of
   `src/app/api/tic/plans/route.ts`: GET `?q=`, min 2 chars, normalize `q` with the SAME suffix-stripping
   rules as SPEC-4's `name_norm`, then Prisma `findMany` where `nameNorm` contains the normalized q
   (insensitive), order by `participants desc nulls last`, take 10, return
   `{items: [{ein, name, state, planName, participants}]}`; 503 shape on DB absence, same as the tic route.
4. **UI** in `src/components/VerifyDoctor.tsx`: in the plan picker block, ABOVE the EIN input, add a
   third `Typeahead` labeled "…or search your employer" (placeholder `Employer name, e.g. Kroger`) that
   hits the new route; suggestion label = employer name, sub = `STATE · EIN sss (plan name)`. On select,
   set the SAME plan state the EIN path sets: `{idType: "ein", id: <ein>, label: <employer name>}`. No
   other UI changes.
5. Gates: `npx tsc --noEmit` clean; `npm test` green (add tests for the normalize-query helper).

## Part 2 — real data (ops, document in a short `DATA.md` in this dir)

Download the latest DOL datasets (public, no auth): the Form 5500 and 5500-SF "latest" CSVs from the
DOL EBSA Form 5500 datasets page (dol.gov → `f_5500_2025_latest.csv.zip` and
`f_5500_sf_2025_latest.csv.zip`, or 2024 if 2025 isn't posted). Unzip, run:
`tsx dol5500-employers.ts --in <5500.csv> --in <5500sf.csv> --out employers.ndjson`
Report the row counts in the PR/summary. Do NOT commit the CSVs or the ndjson (they're large; the
ndjson path gets loaded via `employers:load` locally).

## Doctrine constraint (non-negotiable)
The search result feeds an existing provenance-shaped flow — do not add any coverage claims, do not
change `/api/tic/verify`, and do not alter any rendered coverage copy. This slice is identity lookup only.
