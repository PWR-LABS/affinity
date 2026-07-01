import { NextResponse } from "next/server";

import { searchDrugs } from "@/lib/drugs/rxterms";

export const dynamic = "force-dynamic";

/**
 * Drug-name typeahead → specific products, via NLM RxTerms (complete + oral-inclusive). The Marketplace's
 * own /drugs/autocomplete prefix-caps and buries common oral generics, so we search RxTerms and check
 * coverage against the Marketplace with the resulting RxCUIs (which it accepts).
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ items: [] });
  try {
    const items = await searchDrugs(q);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [], error: "lookup failed" }, { status: 502 });
  }
}
