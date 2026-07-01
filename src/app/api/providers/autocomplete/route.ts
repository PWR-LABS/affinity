import { NextResponse } from "next/server";

import { MarketplaceClient } from "@/lib/marketplace/client";

export const dynamic = "force-dynamic";

/** Provider-name typeahead near a ZIP → NPIs. Key stays server-side. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const zip = sp.get("zip")?.trim() ?? "";
  const year = Number(sp.get("year") ?? "2026");
  if (q.length < 2 || !/^\d{5}$/.test(zip)) return NextResponse.json({ items: [] });
  try {
    const client = new MarketplaceClient();
    const items = (await client.providersAutocomplete(q, zip, year)).slice(0, 12).map((p) => ({
      npi: p.npi,
      name: p.name,
      specialty: p.specialties?.[0] ?? p.taxonomy,
    }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [], error: "lookup failed" }, { status: 502 });
  }
}
