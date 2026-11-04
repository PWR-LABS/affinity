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
            {tab.key === "employer" ? (tab.ready ? "Recent listings" : "Recent sources unavailable") : (tab.ready ? "Loaded" : "Index pending")}
          </span>
        </Link>
      ))}
    </nav>
  );
}

export function CoverageUnavailable({ children, title = "Source index not loaded here yet." }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="coverage-unavailable" role="status">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
