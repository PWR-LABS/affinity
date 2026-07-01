"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It replaces the whole document, so it
 * renders its own <html>/<body> with inline styles (global CSS may not be applied at this point).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Global error:", error?.message, error?.digest);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif", background: "#faf6f0", color: "#2a2620", margin: 0 }}>
        <div style={{ maxWidth: "40rem", margin: "0 auto", padding: "4rem 1.25rem" }}>
          <p style={{ color: "#1f8a3f", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "0.8rem", margin: 0 }}>
            Something went wrong
          </p>
          <h1 style={{ fontSize: "1.6rem", margin: "0.4rem 0 0.6rem" }}>The page failed to load.</h1>
          <p style={{ color: "#6f665a", lineHeight: 1.5, margin: 0 }}>
            We hit an unexpected error. Nothing you entered is stored. Please reload the page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: "1.4rem", padding: "0.6rem 1.35rem", borderRadius: 999, background: "#1f8a3f", color: "#fff", border: "none", fontWeight: 600, cursor: "pointer" }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
