import { NextResponse } from "next/server";
import { MARKETPLACE_CATALOG, marketplaceCatalogFreshness, SUPPORTED_MARKETPLACE_PLAN_YEARS } from "@/lib/marketplace/states";
import { MEDICAID_GUIDANCE_REVIEWED, medicaidGuidanceCurrent } from "@/lib/medicaid/federal";

export const dynamic = "force-dynamic";

/** Source freshness is distinct from liveness, reachability and policy-content review. */
export async function GET() {
  const marketplace = marketplaceCatalogFreshness();
  return NextResponse.json({
    overall: marketplace.status === "current" && medicaidGuidanceCurrent() ? "covered_scopes_checked" : "attention_required",
    marketplace: { ...marketplace, defaultYear: MARKETPLACE_CATALOG.defaultYear, supportedYears: SUPPORTED_MARKETPLACE_PLAN_YEARS, scope: "Official year/platform metadata and bounded synthetic availability probes; live quotes are requested separately." },
    guidance: { lastReviewed: MEDICAID_GUIDANCE_REVIEWED, status: medicaidGuidanceCurrent() ? "within_review_window" : "review_required", scope: "Policy meaning and state application completion are not certified by the catalog refresh." },
    indexedCoverage: { status: "not_certified_by_catalog_refresh" },
  }, { status: marketplace.status === "current" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
