import type { MetadataRoute } from "next";

const BASE = "https://affinity.pwr-labs.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${BASE}/plans`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/verify`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/verify/medicare-drug`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/how-it-works`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
