import { NextResponse } from "next/server";

import { searchDrugs } from "@/lib/drugs/rxterms";

export const dynamic = "force-dynamic";

/**
 * Drug-name typeahead → specific products, via NLM RxTerms (complete + oral-inclusive). The Marketplace's
 * own /drugs/autocomplete prefix-caps and buries common oral generics, so we search RxTerms and check
 * coverage against the Marketplace with the resulting RxCUIs (which it accepts).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ items: [] }, { status: 400 });
  }
  const q = typeof (body as { q?: unknown } | null)?.q === "string"
    ? (body as { q: string }).q.trim().slice(0, 100)
    : "";
  if (q.length < 2) return NextResponse.json({ items: [] });
  try {
    const items = await searchDrugs(q);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [], error: "lookup failed" }, { status: 502 });
  }
}
