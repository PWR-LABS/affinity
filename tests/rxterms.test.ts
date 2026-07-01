import assert from "node:assert/strict";
import { test } from "node:test";

import { flattenRxTerms } from "@/lib/drugs/rxterms";

// Real-shape RxTerms response for a drug that comes as both oral pills and injectables. The plain oral
// generic tablet is exactly what the Marketplace picker buries; RxTerms surfaces it. RXCUIS run parallel
// to STRENGTHS_AND_FORMS.
const ONDANSETRON = [
  3,
  ["ondansetron (Oral Pill)", "ondansetron (Injectable)"],
  {
    STRENGTHS_AND_FORMS: [
      ["4 mg Disintegrating Tab", "8 mg Tab", "4 mg Tab"],
      ["2 mg/mL Injection", "4 mg/2 mL Injection"],
    ],
    RXCUIS: [
      ["1247432", "312086", "312085"],
      ["330871", "330872"],
    ],
  },
] as [number, string[], Record<string, string[][]>];

test("flattens parallel name/strength/rxcui arrays into suggestions", () => {
  const out = flattenRxTerms(ONDANSETRON);
  assert.equal(out.length, 5); // 3 oral + 2 injectable
  const generic = out.find((s) => s.rxcui === "312085");
  assert.ok(generic, "the plain generic oral tablet must be present");
  assert.match(generic.label, /ondansetron \(Oral Pill\) 4 mg Tab/);
});

test("oral forms rank ahead of injectables", () => {
  const out = flattenRxTerms(ONDANSETRON);
  const firstInjectableIdx = out.findIndex((s) => /injection/i.test(s.label));
  const lastOralIdx = out.map((s) => /oral/i.test(s.label)).lastIndexOf(true);
  assert.ok(lastOralIdx < firstInjectableIdx, "every oral option should come before any injectable");
});

test("dedupes rxcuis and tolerates a malformed/empty response", () => {
  const dup = [1, ["X (Oral Pill)"], { STRENGTHS_AND_FORMS: [["1 mg Tab", "1 mg Tab"]], RXCUIS: [["111", "111"]] }] as [
    number,
    string[],
    Record<string, string[][]>,
  ];
  assert.equal(flattenRxTerms(dup).length, 1);
  assert.deepEqual(flattenRxTerms([0, [], {}] as [number, string[], Record<string, string[][]>]), []);
});
