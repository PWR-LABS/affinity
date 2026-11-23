import { NextResponse } from "next/server";

import { MAX_PARTD_DRUGS } from "@/lib/partd/selection";
import { PART_D_STATE_ERROR, pdpRegionCodeForState } from "@/lib/partd/regions";
import { queryPartDShortlist } from "@/lib/partd/shortlist";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const state = typeof b.state === "string" ? b.state.trim().toUpperCase() : "";
  const contractYear = Number(b.contractYear ?? 2026);
  const rawRxcuis = Array.isArray(b.rxcuis) ? b.rxcuis : [];
  const rxcuis = [...new Set(rawRxcuis.map((value) => String(value).trim()))];

  if (!pdpRegionCodeForState(state)) {
    return NextResponse.json({ error: PART_D_STATE_ERROR }, { status: 400 });
  }
  if (!Number.isInteger(contractYear) || contractYear < 2020 || contractYear > 2030) {
    return NextResponse.json({ error: "Enter a valid contract year." }, { status: 400 });
  }
  if (rxcuis.length === 0) {
    return NextResponse.json({ error: "Add at least one medication." }, { status: 400 });
  }
  if (rxcuis.length > MAX_PARTD_DRUGS || rxcuis.some((rxcui) => !/^\d{1,8}$/.test(rxcui))) {
    return NextResponse.json(
      { error: `Enter up to ${MAX_PARTD_DRUGS} valid medication products.` },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await queryPartDShortlist({ state, rxcuis, contractYear }));
  } catch {
    return NextResponse.json(
      { error: "The Medicare Part D index isn't available in this environment yet." },
      { status: 503 },
    );
  }
}
