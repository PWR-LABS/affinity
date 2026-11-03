import { MARKETPLACE_CATALOG, marketplaceCatalogFreshness, SUPPORTED_MARKETPLACE_PLAN_YEARS } from "@/lib/marketplace/states";
import { FEDERAL_MEDICAID_CHANGES, MEDICAID_GUIDANCE_REVIEWED, medicaidGuidanceCurrent } from "@/lib/medicaid/federal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sources and freshness" };

export default function Sources() {
  const status = marketplaceCatalogFreshness();
  const date = (value: string) => new Date(value).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" });
  return <div className="sources-page">
    <div className="page-header"><h1 className="page-title">Sources and freshness</h1><p className="page-subtitle">A source check, a policy review, and confirmation of your coverage are different things.</p></div>
    <section className="page-panel">
      <h2>Marketplace plans</h2>
      <p>Year and state-marketplace information was checked on {date(status.checkedAt)}. It must be checked again before {date(status.expiresAt)}.</p>
      <p>{status.status === "current" ? "Those checks are within their freshness window." : "Those checks are overdue. We pause estimates and direct you to official services."} The available coverage years are {SUPPORTED_MARKETPLACE_PLAN_YEARS.join(", ")}; the default is {MARKETPLACE_CATALOG.defaultYear}, based on the official source.</p>
      <p>Plan prices and reported doctor and medication matches are requested from the Marketplace when you search. A source-reported match does not guarantee coverage. Confirm with the office, insurer and official Marketplace before enrolling.</p>
      <a href="https://www.healthcare.gov/marketplace-in-your-state/" target="_blank" rel="noreferrer">Find your official Marketplace ↗</a>
    </section>
    <section className="page-panel">
      <h2>Medicaid guidance</h2>
      <p>Our policy summaries were last reviewed on {MEDICAID_GUIDANCE_REVIEWED}. {medicaidGuidanceCurrent() ? "They are within their review window." : "Their review is overdue, so detailed summaries are withheld while we direct you to official guidance."} Automatically fetching a document does not renew that review.</p>
      <p>State application links and phone contexts have a separate review history; a reachable page does not prove that you can complete an application or renewal there. Your state notice controls your next step.</p>
      <ul>{FEDERAL_MEDICAID_CHANGES.map((source) => <li key={source.id}><a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceLabel} ↗</a></li>)}</ul>
      <a href="https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip" target="_blank" rel="noreferrer">Official state Medicaid directory ↗</a>
    </section>
    <section className="page-panel"><h2>Employer and Medicare drug checks</h2><p>These depend on separately loaded source indexes. The Marketplace year refresh does not certify their freshness or coverage. Confirm the plan year and source shown by the tool, and verify with the insurer or official Medicare service.</p><a href="https://www.medicare.gov/plan-compare/" target="_blank" rel="noreferrer">Official Medicare Plan Finder ↗</a></section>
  </div>;
}
