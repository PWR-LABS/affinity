import Link from "next/link";

import type { CoverageReadiness } from "@/lib/coverage-readiness";

interface CoverageTabsProps {
  active: "employer" | "partd";
  readiness: CoverageReadiness;
}

export function CoverageTabs({ active, readiness }: CoverageTabsProps) {
  const tabs = [
    { key: "employer" as const, href: "/verify", label: "Employer doctor", ready: readiness.employer },
    { key: "partd" as const, href: "/verify/medicare-drug", label: "Medicare drug", ready: readiness.partD },
  ];

  return (
    <nav className="coverage-tabs" aria-label="Coverage verification tools">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className="coverage-tab"
          aria-current={active === tab.key ? "page" : undefined}
        >
          <span>{tab.label}</span>
          <span className="coverage-tab-status" data-ready={tab.ready ? "true" : "false"}>
            {tab.ready ? "Loaded" : "Index pending"}
          </span>
        </Link>
      ))}
    </nav>
  );
}

export function CoverageUnavailable({ children }: { children: React.ReactNode }) {
  return (
    <div className="coverage-unavailable" role="status">
      <strong>Source index not loaded here yet.</strong>
      <p>{children}</p>
    </div>
  );
}
