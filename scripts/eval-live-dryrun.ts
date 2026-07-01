/**
 * eval:live-dryrun — exercise the LIVE code paths without a real key or network.
 *
 * The fixture-mode evals prove the engines; this proves the *wiring* that only runs when
 * MARKETPLACE_API_KEY is set — the Marketplace client (rating-area lookup + plan search), the MRF
 * loader, and `matchProfileLive` — by injecting a mock `fetch`. So the moment the real key lands there
 * are no surprises in the request/response plumbing. Exit code is the gate: 0 pass, 1 fail.
 */
import { MarketplaceClient, MarketplaceConfigError } from "@/lib/marketplace/client";
import { matchProfileLive } from "@/lib/matching/live";
import { loadMrfDataset } from "@/lib/mrf/client";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** A mock transport that mimics the Marketplace API + issuer MRF endpoints. */
function mockFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/counties/by/zip/")) {
      return json({ counties: [{ fips: "12345", state: "XX", name: "Test County", zipcode: "00000" }] });
    }
    if (url.includes("/plans/search") && method === "POST") {
      return json({
        total: 2,
        plans: [
          {
            id: "PLAN_A",
            name: "Plan A (broad)",
            premium: 480,
            provider_coverage: [{ npi: "1", coverage: "Covered" }],
            drug_coverage: [{ rxcui: "D", coverage: "Covered", drug_tier: "GENERIC" }],
          },
          {
            id: "PLAN_B",
            name: "Plan B (narrow)",
            premium: 350,
            provider_coverage: [{ npi: "1", coverage: "NotCovered" }],
            drug_coverage: [],
          },
        ],
      });
    }
    if (url.includes("providers.json")) {
      return json([{ npi: "1", plans: [{ plan_id: "PLAN_A" }], last_updated_on: "2026-06-17" }]);
    }
    if (url.includes("drugs.json")) {
      return json([{ rxnorm_id: "D", plans: [{ plan_id: "PLAN_A", drug_tier: "GENERIC" }], last_updated_on: "2026-06-17" }]);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

async function main(): Promise<void> {
  console.log("eval:live-dryrun — live wiring through a mock transport (no key, no network)");

  // 1. The client is inert without a key — methods throw a catchable config error.
  const noKey = new MarketplaceClient({ apiKey: undefined, fetchImpl: mockFetch(), useCache: false });
  check("client reports not-live without a key", !noKey.isLive);
  try {
    await noKey.countiesByZip("00000");
    check("countiesByZip throws without a key", false);
  } catch (e) {
    check("countiesByZip throws MarketplaceConfigError without a key", e instanceof MarketplaceConfigError);
  }

  // 2. With a (test) key, the full live path resolves area → searches plans → reconciles vs MRF → ranks.
  const client = new MarketplaceClient({ apiKey: "test", fetchImpl: mockFetch(), useCache: false });
  check("client reports live with a key", client.isLive);

  const counties = await client.countiesByZip("00000");
  check("rating-area lookup returns a county", counties.length === 1 && counties[0].fips === "12345");

  const dataset = await loadMrfDataset({
    providersUrl: "https://issuer.example/providers.json",
    drugsUrl: "https://issuer.example/drugs.json",
    fetchImpl: mockFetch(),
    useCache: false,
  });
  check("MRF dataset loads providers + drugs", dataset.providerCount === 1 && dataset.drugCount === 1);

  const ranked = await matchProfileLive({
    client,
    profile: { doctors: [{ npi: "1", label: "Dr. One" }], medications: [{ rxcui: "D", label: "Drug D" }] },
    dataset,
    options: { zip: "00000", income: 25000, ages: [40], year: 2026 },
  });
  check("both plans ranked", ranked.length === 2, `${ranked.length}`);
  check("every plan answered all subjects", ranked.every((m) => m.summary.doctorsTotal === 1 && m.summary.drugsTotal === 1));
  check("broad plan (full coverage) ranks first", ranked[0]?.planId === "PLAN_A", ranked.map((r) => r.planId).join(","));
  check("the API↔MRF agreement was reached on the broad plan", ranked[0]?.providers[0]?.status === "covered");

  for (const m of ranked) {
    console.log(`   ${m.planId}: doctors ${m.summary.doctorsCovered}/${m.summary.doctorsTotal} · meds ${m.summary.drugsOnFormulary}/${m.summary.drugsTotal} · score ${m.summary.matchScore}`);
  }

  if (failures.length) {
    console.log(`\n  ✗ FAIL (${failures.length}):`);
    for (const f of failures) console.log(`     - ${f}`);
    console.log("\nFAIL\n");
    process.exit(1);
  }
  console.log("\n  ✓ live wiring (client + MRF loader + matchProfileLive) works end to end.");
  console.log("\nPASS\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("eval:live-dryrun crashed:", err);
  process.exit(1);
});
