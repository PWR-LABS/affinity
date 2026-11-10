import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";

import { SiteShell } from "@/components/SiteShell";
import { marketplaceCatalogFreshness } from "@/lib/marketplace/states";

import "./globals.css";

// Evaluate the receipt on each request, including otherwise static pages.
export const dynamic = "force-dynamic";

// Display face — the [PWR] LABS canon wordmark typeface. Body copy stays on the clean system stack.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const DESCRIPTION =
  "Work through your coverage options with guru: discover Medicaid and Marketplace routes, check employer network evidence, compare declared premiums and find official next steps. Free and neutral.";

export const metadata: Metadata = {
  metadataBase: new URL("https://affinity.pwr-labs.ai"),
  title: {
    default: "[affinity.] — Work out your coverage with guru",
    template: "%s · [affinity.]",
  },
  description: DESCRIPTION,
  applicationName: "[affinity.]",
  authors: [{ name: "[PWR] LABS" }],
  openGraph: {
    title: "[affinity.] — Work out your coverage with guru",
    description: DESCRIPTION,
    url: "/",
    siteName: "[affinity.]",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "[affinity.] — Work out your coverage",
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
        <SiteShell freshness={marketplaceCatalogFreshness()}>{children}</SiteShell>
      </body>
    </html>
  );
}
