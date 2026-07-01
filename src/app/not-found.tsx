import Link from "next/link";

export const metadata = { title: "Page not found" };

/** Branded 404 — renders inside the site shell, so the header/footer/skip-link stay intact. */
export default function NotFound() {
  return (
    <div className="notice-page">
      <p className="notice-eyebrow">404 — page not found</p>
      <h1 className="page-title">This page wandered off.</h1>
      <p className="page-subtitle">
        The page you&rsquo;re looking for doesn&rsquo;t exist or has moved. Let&rsquo;s get you back to checking your
        coverage.
      </p>
      <div className="notice-actions">
        <Link href="/" className="cta">Check my coverage</Link>
        <Link href="/how-it-works" className="notice-link">How it works</Link>
      </div>
    </div>
  );
}
