/**
 * Drug search via NLM RxTerms (clinicaltables.nlm.nih.gov) — the patient-facing prescription autocomplete
 * the NIH itself ships. It is COMPLETE and oral-inclusive and dose-specific, unlike the Marketplace's
 * `/drugs/autocomplete`, which prefix-caps at ~10 results and floats injectables/specialty forms to the
 * top — so the common oral generic people actually take gets buried past the cap (for a drug that also
 * comes as an injectable, the plain oral tablet can be missing from the list entirely). RxTerms returns
 * standard RxNorm RxCUIs, which the Marketplace `/drugs/covered` formulary check accepts (verified live).
 */
export interface DrugSuggestion {
  rxcui: string;
  /** e.g. "ondansetron (Oral Pill) 8 mg Tab" */
  label: string;
}

const RXTERMS = "https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search";

/** RxTerms shape: [total, displayNames[], extraFields{ STRENGTHS_AND_FORMS:[[...]], RXCUIS:[[...]] }, ...] */
type RxTermsResponse = [number, string[], Record<string, string[][]>, ...unknown[]];

export async function searchDrugs(q: string, fetchImpl: typeof fetch = fetch, limit = 20): Promise<DrugSuggestion[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  // RxTerms searches the name field; strength and form come back in separate fields.
  const [, name = query, qualifiers] = query.match(/^(.{2,}?)\s+(\d.*)$/) ?? [];
  const url = `${RXTERMS}?terms=${encodeURIComponent(name)}&ef=STRENGTHS_AND_FORMS,RXCUIS&maxList=30`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("Drug lookup unavailable");
  const data = (await res.json()) as RxTermsResponse;
  if (!qualifiers) return flattenRxTerms(data, limit);
  const required = [...drugTokens(qualifiers)];
  return flattenRxTerms(data, Infinity).filter(({ label }) => {
    const tokens = drugTokens(label);
    return required.every((token) => tokens.has(token));
  }).slice(0, limit);
}

function drugTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/\d+(?:\.\d+)?(?:\s*(?:mcg|mg|g|ml|units?)\b|\s*%)?|[a-z]+/g) ?? [];
  const result = new Set<string>();
  for (const raw of tokens) {
    const token = raw.replace(/\s+/g, "");
    if (/^(tabs?|tablets?)$/.test(token)) result.add("tab");
    else if (/^(caps?|capsules?)$/.test(token)) result.add("cap");
    else result.add(token);
    const amount = /^\d+(?:\.\d+)?/.exec(token);
    if (amount) result.add(amount[0]);
  }
  return result;
}

/** Flatten the parallel name/strength/rxcui arrays into one suggestion list, oral forms first. */
export function flattenRxTerms(data: RxTermsResponse, limit = 20): DrugSuggestion[] {
  const names = data?.[1] ?? [];
  const ef = data?.[2] ?? {};
  const forms = ef.STRENGTHS_AND_FORMS ?? [];
  const rxcuis = ef.RXCUIS ?? [];

  const out: DrugSuggestion[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const sf = forms[i] ?? [];
    const rc = rxcuis[i] ?? [];
    for (let j = 0; j < sf.length; j++) {
      const rxcui = rc[j];
      if (!rxcui || seen.has(rxcui)) continue;
      seen.add(rxcui);
      out.push({ rxcui, label: `${names[i]} ${sf[j]}`.replace(/\s+/g, " ").trim() });
    }
  }
  // Oral pills first (what most people take), then other oral, then the rest. Stable within a rank.
  return out.map((s, i) => ({ s, i })).sort((a, b) => oralRank(a.s.label) - oralRank(b.s.label) || a.i - b.i).map(({ s }) => s).slice(0, limit);
}

function oralRank(label: string): number {
  const l = label.toLowerCase();
  // Plain oral pills first; niche/branded forms (e.g. the "Sensor" digital pill) just behind; then other
  // oral forms; then injectables/specialty. Keeps the common generic the user actually takes at the top.
  if (l.includes("(oral pill)")) return /\bsensor\b/.test(l) ? 0.5 : 0;
  if (l.includes("oral")) return 1;
  return 2;
}
