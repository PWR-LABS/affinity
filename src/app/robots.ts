import type { MetadataRoute } from "next";

const BASE = "https://affinity.pwr-labs.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
