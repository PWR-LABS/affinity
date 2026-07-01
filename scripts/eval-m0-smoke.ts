/**
 * M0 smoke gate — headless, no browser, DB optional.
 *
 * Proves the [affinity.] spine is wired:
 *   1. Prisma schema validates.
 *   2. `GET /api/health` returns 200 with the expected body shape.
 *   3. DOCTRINE: a coverage answer never renders as a bare "in-network" — every rendering carries a
 *      source + confidence, and low-confidence/conflicting answers tell the user to confirm.
 *   4. When DATABASE_URL is set, a Profile → Plan → CoverageClaim round-trip works and the claim
 *      stores provenance (source + fetchedAt + confidence). Without a DB this step prints a skip
 *      banner so CI without Postgres still passes.
 *
 * Exit code is the gate: 0 = pass, 1 = fail.
 */
import { spawnSync } from "node:child_process";

import { makeCoverageAnswer, needsConfirmation, renderCoverageAnswer } from "@/lib/provenance";

type Result = { name: string; ok: boolean; note?: string };

function validateSchema(): Result {
  const env = { ...process.env };
  if (!env.DATABASE_URL) {
    env.DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public";
  }
  const res = spawnSync("npx prisma validate", { shell: true, stdio: "pipe", env });
  const ok = res.status === 0;
  return {
    name: "prisma-schema-valid",
    ok,
    note: ok ? undefined : (res.stderr?.toString() || res.stdout?.toString() || "").trim().slice(-400),
  };
}

async function healthRoute(): Promise<Result> {
  const { GET } = await import("@/app/api/health/route");
  const res = await GET(new Request("http://localhost/api/health"));
  const body = (await res.json()) as {
    status?: string;
    service?: string;
    checks?: Record<string, string>;
  };
  const ok =
    res.status === 200 &&
    body.service === "affinity" &&
    body.status === "ok" &&
    body.checks?.app === "ok";
  return {
    name: "health-route-200",
    ok,
    note: ok ? undefined : `status=${res.status} body=${JSON.stringify(body)}`,
  };
}

/** The core non-negotiable: no surface emits an unqualified "in-network". */
function noBareClaim(): Result {
  const fetchedAt = "2026-06-17T12:00:00.000Z";
  // A confident "yes" must still name its source + confidence.
  const yes = makeCoverageAnswer({
    value: "yes",
    source: "MARKETPLACE_API",
    fetchedAt,
    subjectLabel: "Dr. Test (NPI 1234567890)",
  });
  const rendered = renderCoverageAnswer(yes);
  const namesSource = /per the/i.test(rendered);
  const showsConfidence = /confidence/i.test(rendered);

  // An "unknown" answer must always demand confirmation and never read as covered.
  const unknown = makeCoverageAnswer({ value: "unknown", source: "ISSUER_MRF", fetchedAt });
  const unknownHonest = needsConfirmation(unknown) && /unknown/i.test(renderCoverageAnswer(unknown));

  const ok = namesSource && showsConfidence && unknownHonest;
  return {
    name: "no-bare-in-network-claim",
    ok,
    note: ok ? "every claim carries source + confidence; unknown demands confirmation" : `rendered="${rendered}"`,
  };
}

async function spineRoundTrip(): Promise<Result> {
  if (!process.env.DATABASE_URL) {
    return { name: "profile-plan-spine-roundtrip", ok: true, note: "skipped (DATABASE_URL unset)" };
  }
  const { prisma } = await import("@/lib/prisma");
  const zip = "00000";
  try {
    await prisma.profile.deleteMany({ where: { zip, label: "m0-smoke" } });
    const profile = await prisma.profile.create({
      data: {
        label: "m0-smoke",
        zip,
        memberAges: [34],
        doctors: { create: [{ npi: "1234567890", name: "Smoke Doc" }] },
        medications: { create: [{ rxcui: "617310", name: "Atorvastatin 20mg" }] },
      },
      include: { doctors: true, medications: true },
    });
    const plan = await prisma.plan.create({
      data: {
        externalId: "SMOKE0000000001",
        year: 2026,
        issuerName: "Smoke Issuer",
        marketingName: "Smoke Silver",
        metalLevel: "Silver",
        source: "marketplace-api",
        fetchedAt: new Date(),
        coverageClaims: {
          create: [
            {
              kind: "PROVIDER",
              subjectKey: "1234567890",
              inNetwork: true,
              source: "MARKETPLACE_API",
              fetchedAt: new Date(),
              confidence: 0.55,
            },
          ],
        },
      },
      include: { coverageClaims: true },
    });
    const claim = plan.coverageClaims[0];
    const ok =
      profile.doctors.length === 1 &&
      profile.medications.length === 1 &&
      !!claim &&
      claim.source === "MARKETPLACE_API" &&
      claim.confidence === 0.55 &&
      claim.fetchedAt instanceof Date;
    await prisma.profile.delete({ where: { id: profile.id } });
    await prisma.plan.delete({ where: { id: plan.id } });
    return {
      name: "profile-plan-spine-roundtrip",
      ok,
      note: ok ? "profile+plan+coverage-claim create/read/delete ok; provenance stored" : "round-trip mismatch",
    };
  } catch (err) {
    return { name: "profile-plan-spine-roundtrip", ok: false, note: String(err).slice(0, 400) };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log("eval:m0-smoke — [affinity.] spine");
  const results: Result[] = [validateSchema(), noBareClaim(), await healthRoute(), await spineRoundTrip()];
  let allOk = true;
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗";
    console.log(`  ${tag} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
    if (!r.ok) allOk = false;
  }
  console.log(allOk ? "\nPASS\n" : "\nFAIL\n");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("eval:m0-smoke crashed:", err);
  process.exit(1);
});
