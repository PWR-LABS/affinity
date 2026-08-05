"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Check", match: (p: string) => p === "/" },
  { href: "/plans", label: "Plans", match: (p: string) => p.startsWith("/plans") },
  { href: "/verify", label: "Verify", match: (p: string) => p.startsWith("/verify") },
  { href: "/how-it-works", label: "How it works", match: (p: string) => p.startsWith("/how-it-works") },
];

/** Warm, centered consumer shell — header + content + footer. No dev sidebar. */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  return (
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
        {children}
      </main>

      <footer className="site-footer">
        <p>
          Free and neutral — no commissions, no ads, no accounts. Your answers aren&rsquo;t stored. This is decision
          support, not insurance advice; the final word belongs to your state Medicaid office and the official
          Marketplace. <Link href="/how-it-works">How it works</Link>.
        </p>
      </footer>
    </div>
  );
}
