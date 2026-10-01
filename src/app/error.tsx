"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Segment-level error boundary — keeps a thrown render from white-screening the live tool. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Error messages can contain request-specific values. Keep only the framework digest.
    console.error("App render error:", error?.digest ?? "no_digest");
  }, [error]);

  return (
    <div className="notice-page">
      <p className="notice-eyebrow">Something went wrong</p>
      <h1 className="page-title">That didn&rsquo;t work — but your data is safe.</h1>
      <p className="page-subtitle">
        We hit an unexpected error. We do not save a household profile here. Try again, or head back to the start.
      </p>
      <div className="notice-actions">
        <button type="button" className="cta" onClick={() => reset()}>Try again</button>
        <Link href="/" className="notice-link">Back to start</Link>
      </div>
    </div>
  );
}
