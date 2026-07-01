/**
 * poc-live — a live end-to-end run against a configured demo profile (M5).
 *
 * Pulls live Marketplace data for the AFFINITY_EVAL_* profile (set locally in .env) and answers the two
 * questions that matter: (1) does the federal system say the household is Medicaid-eligible? and (2) if
 * they were on the marketplace, does any real plan keep BOTH configured health systems in-network and
 * cover their meds? Coverage comes from the API only (no issuer MRF cross-check yet), so answers are
 * tagged "one source" — honest, not asserted. Run: source .env, then tsx scripts/poc-live.ts.
 */
import { MarketplaceClient } from "@/lib/marketplace/client";
import type { MarketplaceDrugCoverage, MarketplaceProviderCoverage } from "@/lib/marketplace/types";
import { matchPlan, type PlanCoverageInputs } from "@/lib/matching/engine";
import type { MatchProfileInput, PlanMatch } from "@/lib/matching/types";
import { datasetFromRecords } from "@/lib/mrf/client";
import { analyzeBridges } from "@/lib/network/bridge";
import type { ProviderSystemTag } from "@/lib/network/types";

const ZIP = process.env.AFFINITY_EVAL_ZIP ?? "00000";
const INCOME = Number(process.env.AFFINITY_EVAL_INCOME ?? "30000");
const AGES = (process.env.AFFINITY_EVAL_AGES ?? "35").split(",").map(Number).filter((n) => n > 0);
const YEAR = Number(process.env.AFFINITY_EVAL_YEAR ?? "2026");
const NPIS = (process.env.AFFINITY_EVAL_NPIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const RXCUIS = (process.env.AFFINITY_EVAL_RXCUIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function tags(): ProviderSystemTag[] {
  const critical = new Set((process.env.AFFINITY_EVAL_CRITICAL_NPIS ?? "").split(",").map((s) => s.trim()));
  return (process.env.AFFINITY_EVAL_PROVIDER_SYSTEMS ?? "")
    .split(",").map((p) => p.trim()).filter(Boolean)
    .map((p) => { const [npi, system] = p.split(":").map((x) => x.trim()); return { npi, system, critical: critical.has(npi) }; });
}

// Illustrative labels for pretty-printing; the actual RxCUIs come from AFFINITY_EVAL_RXCUIS (local .env).
const DRUG_LABEL: Record<string, string> = {
  "860975": "metformin 500 mg", "314076": "lisinopril 10 mg", "617312": "atorvastatin 10 mg",
  "197361": "amlodipine 5 mg", "966208": "levothyroxine 50 mcg",
};

async function main(): Promise<void> {
  const client = new MarketplaceClient();
  if (!client.isLive) throw new Error("MARKETPLACE_API_KEY not set — source .env first.");
  const fetchedAt = new Date().toISOString();

  const counties = await client.countiesByZip(ZIP);
  const c = counties[0];
  const place = { zipcode: ZIP, countyfips: c.fips, state: c.state };
  const household = { income: INCOME, people: AGES.map((age) => ({ age })) };
  console.log(`\n[affinity.] live — ${ZIP} ${c.name}, ${c.state} · income $${INCOME.toLocaleString()} · age ${AGES.join(",")}\n`);

  // (1) Medicaid / subsidy verdict — the headline.
  const elig = (await client.estimateEligibility({ household, place, year: YEAR })).estimates?.[0] ?? {};
  const medicaid = (elig as { is_medicaid_chip?: boolean }).is_medicaid_chip;
  console.log("══ Eligibility (HealthCare.gov) ══");
  console.log(`  Medicaid/CHIP eligible: ${medicaid ? "YES" : "no"}   ·   APTC subsidy: $${elig.aptc ?? 0}/mo`);
  console.log(medicaid
    ? "  → You qualify for Medicaid (free). Marketplace gives $0 subsidy at this income — don't buy a plan.\n"
    : "  → Marketplace with subsidy. The plan analysis below is your real picture.\n");

  // Pull all plans (live page size is fixed at 10, so paginate by 10).
  const plans = [] as { id: string; name?: string }[];
  let total = Infinity;
  for (let offset = 0; plans.length < total && offset < 300; offset += 10) {
    const res = await client.searchPlans({ household, market: "Individual", place, year: YEAR, limit: 10, offset });
    if (res.plans.length === 0) break;
    plans.push(...res.plans);
    total = res.total ?? plans.length;
  }
  const planIds = plans.map((p) => p.id);
  console.log(`══ Network bridge — across ${planIds.length} real ${ZIP} plans ══`);

  // Live coverage (batched). Group by plan.
  const [provCov, drugCov] = await Promise.all([
    client.providersCovered(NPIS, planIds, YEAR),
    client.drugsCovered(RXCUIS, planIds, YEAR),
  ]);
  const provByPlan = new Map<string, Map<string, MarketplaceProviderCoverage>>();
  for (const r of provCov) {
    if (!r.plan_id) continue;
    if (!provByPlan.has(r.plan_id)) provByPlan.set(r.plan_id, new Map());
    provByPlan.get(r.plan_id)!.set(r.npi, r);
  }
  const drugByPlan = new Map<string, Map<string, MarketplaceDrugCoverage>>();
  for (const r of drugCov) {
    if (!r.plan_id) continue;
    if (!drugByPlan.has(r.plan_id)) drugByPlan.set(r.plan_id, new Map());
    drugByPlan.get(r.plan_id)!.set(r.rxcui, r);
  }

  const profile: MatchProfileInput = {
    doctors: NPIS.map((npi) => ({ npi })),
    medications: RXCUIS.map((rxcui) => ({ rxcui, label: DRUG_LABEL[rxcui] })),
  };
  const emptyMrf = datasetFromRecords([], [], fetchedAt); // API-only; MRF cross-check is a later layer
  const matches: PlanMatch[] = plans.map((p) => {
    const inputs: PlanCoverageInputs = {
      planId: p.id,
      planLabel: p.name,
      apiProviders: provByPlan.get(p.id) ?? new Map(),
      apiDrugs: drugByPlan.get(p.id) ?? new Map(),
    };
    return matchPlan(profile, inputs, emptyMrf, fetchedAt);
  });

  const report = analyzeBridges({ matches, tags: tags(), asOf: fetchedAt, isLive: true });
  console.log(`  required systems: ${report.requiredSystems.join(" + ")}`);
  console.log(`  Any plan keeps BOTH systems in-network? ${report.anyBridges ? "YES" : "NO"}\n`);
  const bridging = report.plans.filter((p) => p.bridgeStatus === "bridges_all");
  console.log(`  plans keeping every system: ${bridging.length} of ${report.plans.length}`);
  for (const b of report.plans.slice(0, 6)) {
    console.log(`   • [${b.bridgeStatus}] ${b.planLabel ?? b.planId}`);
    console.log(`       keeps: ${b.systemsKept.join(", ") || "none"}${b.systemsLost.length ? ` · loses: ${b.systemsLost.join(", ")}` : ""}${b.criticalGaps.length ? ` · ⚠ critical out: ${b.criticalGaps.map((g) => g.label ?? g.subjectKey).join(", ")}` : ""}`);
  }

  // Drug coverage reality across plans.
  console.log(`\n══ Your meds — covered on how many of ${planIds.length} plans ══`);
  for (const rxcui of RXCUIS) {
    let covered = 0;
    for (const m of drugByPlan.values()) {
      const v = m.get(rxcui)?.coverage?.toLowerCase();
      if (v && v.includes("covered") && !v.includes("notcovered")) covered++;
    }
    console.log(`  ${(DRUG_LABEL[rxcui] ?? rxcui).padEnd(34)} covered on ${covered}/${planIds.length}`);
  }
  console.log("");
}

main().catch((e) => { console.error("poc-live failed:", e); process.exit(1); });
