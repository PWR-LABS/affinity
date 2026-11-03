/** Validate the actual generated catalog in a separate process without the historical fixture hook. */
import { readFileSync } from "node:fs";
import { assertCatalog, catalogFreshness } from "@/lib/marketplace/catalog";
import { STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";

async function main() {
  const catalog: unknown = JSON.parse(readFileSync("src/lib/marketplace/catalog-data.json", "utf8"));
  assertCatalog(catalog, STATE_MEDICAID_RESOURCES.map(({ code }) => code));
  if (catalogFreshness(catalog).status !== "current") throw new Error("catalog_receipt_stale");
  const runtime = await import("@/lib/marketplace/states");
  if (JSON.stringify(runtime.MARKETPLACE_CATALOG) !== JSON.stringify(catalog)) throw new Error("runtime_catalog_mismatch");
  if (runtime.parseMarketplacePlanYear(undefined) !== catalog.defaultYear) throw new Error("runtime_default_mismatch");
  for (const [year, entry] of Object.entries(catalog.years)) {
    if (runtime.parseMarketplacePlanYear(year) !== Number(year)) throw new Error("runtime_year_mismatch");
    for (const { code } of STATE_MEDICAID_RESOURCES) {
      const route = runtime.stateBasedMarketplace(code, Number(year));
      if (entry.models[code] === "SBM" ? JSON.stringify(route) !== JSON.stringify(entry.marketplaces[code]) : route !== undefined) throw new Error("runtime_route_mismatch");
    }
  }
  if (runtime.parseMarketplacePlanYear(Math.max(...Object.keys(catalog.years).map(Number)) + 1) !== undefined) throw new Error("runtime_unknown_year_accepted");
  console.log(JSON.stringify({ status: "verified", defaultYear: catalog.defaultYear, years: Object.keys(catalog.years), jurisdictionsPerYear: 51, runtimeCatalogMatches: true }));
}
main().catch(() => {
  console.error("marketplace_catalog_validation_failed; malformed or overdue source data cannot pass publication");
  process.exitCode = 1;
});
