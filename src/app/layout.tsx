import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";

import { SiteShell } from "@/components/SiteShell";

import "./globals.css";

// Display face — the [PWR] LABS canon wordmark typeface. Body copy stays on the clean system stack.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const DESCRIPTION =
  "Losing Medicaid? Find out in 30 seconds whether you qualify for free Medicaid or a subsidized Marketplace plan — and which plans actually cover your doctors and medications. Free, private, neutral.";

export const metadata: Metadata = {
  metadataBase: new URL("https://affinity.pwr-labs.ai"),
  title: {
    default: "[affinity.] — Medicaid or Marketplace? Find your coverage",
    template: "%s · [affinity.]",
  },
  description: DESCRIPTION,
  applicationName: "[affinity.]",
  authors: [{ name: "[PWR] LABS" }],
  openGraph: {
    title: "[affinity.] — Medicaid or Marketplace? Find your coverage",
    description: DESCRIPTION,
    url: "/",
    siteName: "[affinity.]",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "[affinity.] — Medicaid or Marketplace?",
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#faf6f0",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
