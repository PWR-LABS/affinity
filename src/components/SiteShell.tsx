"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { GuruContextProvider } from './GuruContext';

const NAV = [
  { href: "/", label: "guru", match: (p: string) => p === "/" },
  { href: "/discover", label: "Discover", match: (p: string) => p.startsWith("/discover") || p.startsWith("/medicaid") },
  { href: "/verify", label: "Coverage", match: (p: string) => p.startsWith("/verify") },
  { href: "/plans", label: "Compare", match: (p: string) => p.startsWith("/plans") },
  { href: "/how-it-works", label: "How", match: (p: string) => p.startsWith("/how-it-works") },
];

/** Warm, centered consumer shell — header + content + footer. No dev sidebar. */
export function SiteShell({ children, freshness }: { children: ReactNode; freshness: { status: "current" | "stale"; checkedAt: string } }) {
  const pathname = usePathname() ?? "/";
  return (
    <GuruContextProvider>
    <div className="site">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link href="/" className="site-brand" aria-label="affinity. home">
            <span className="site-brand-bracket">[</span>
            <span className="site-brand-word">affinity</span>
            <span className="site-brand-dot">.</span>
            <span className="site-brand-bracket">]</span>
          </Link>
          <nav className="site-nav" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="site-nav-link" aria-current={n.match(pathname) ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main id="main" className="site-main">
        {freshness.status === "stale" ? <p className="elig-error" role="status">Our Marketplace source checks are overdue. Use official services for current estimates.</p> : null}
        {children}
      </main>

      <footer className="site-footer">
        <p>Marketplace year and routing checks: {new Date(freshness.checkedAt).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })}. <Link href="/sources">Sources and freshness</Link>.</p>
        <p>
          Free and neutral—no commissions, no ads, no accounts. We do not save your household answers. This is decision
          support, not insurance advice; the final word belongs to your state Medicaid office and the official
          Marketplace. <Link href="/how-it-works">How it works</Link>. <Link href="/privacy">Privacy and data flow</Link>.
        </p>
      </footer>
    </div>
    </GuruContextProvider>
  );
}
