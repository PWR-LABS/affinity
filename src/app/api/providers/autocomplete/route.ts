import { NextResponse } from "next/server";

import { MarketplaceClient } from "@/lib/marketplace/client";

export const dynamic = "force-dynamic";

/** Provider-name typeahead near a ZIP → NPIs. Key stays server-side. */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ items: [] }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;
  const q = typeof input.q === "string" ? input.q.trim().slice(0, 100) : "";
  const zip = typeof input.zip === "string" ? input.zip.trim() : "";
  const year = Number(input.year ?? 2026);
  if (q.length < 2 || !/^\d{5}$/.test(zip)) return NextResponse.json({ items: [] });
  try {
    const client = new MarketplaceClient({ useCache: false });
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
