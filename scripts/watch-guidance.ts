/** Source-change detection only. Observation hashes never count as policy review. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { FEDERAL_MEDICAID_CHANGES, MEDICAID_GUIDANCE_REVIEWED, medicaidGuidanceCurrent } from "@/lib/medicaid/federal";
import { FEATURED_MEDICAID_CHANGES } from "@/lib/medicaid/states";

const BASELINE = "src/lib/medicaid/guidance-observations.json";
export const GUIDANCE_SOURCES = [
  ...FEDERAL_MEDICAID_CHANGES.map((source) => ({ id: source.id, url: source.sourceUrl })),
  ...FEATURED_MEDICAID_CHANGES.flatMap((source) => source.sources.map((link, index) => ({ id: `${source.code}-${index}`, url: link.url }))),
  { id: "policy-publication-index", url: "https://www.medicaid.gov/federal-policy-guidance" },
  { id: "state-contact-directory", url: "https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip" },
];

export function contentFingerprint(bytes: Uint8Array, contentType: string) {
  let data: Uint8Array | string = bytes;
  if (/html/i.test(contentType)) {
    const html = new TextDecoder().decode(bytes);
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
    if (!main) throw new Error("source_main_content_missing");
    data = main.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/g, " ").replace(/\s+/g, " ").trim();
    if (data.length < 100) throw new Error("source_content_incomplete");
  } else if (!/pdf/i.test(contentType) || bytes.length < 100) throw new Error("source_type_or_size_unexpected");
  return createHash("sha256").update(data).digest("hex");
}

export async function watchGuidance(options: { baseline?: { records: Array<{ id: string; sha256: string | null }> }; fetchImpl?: typeof fetch; now?: number }) {
  const records = [];
  for (const source of GUIDANCE_SOURCES) {
    let sha256: string | null = null;
    let status = "network_unavailable";
    let httpStatus: number | null = null;
    try {
      const response = await (options.fetchImpl ?? fetch)(source.url, { signal: AbortSignal.timeout(15_000), cache: "no-store", headers: { accept: "text/html,application/pdf" } });
      httpStatus = response.status;
      status = "http_error";
      if (response.ok) {
        status = "content_unparsed";
        sha256 = contentFingerprint(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type") ?? "");
        const previous = options.baseline?.records.find((record) => record.id === source.id)?.sha256;
        status = previous ? previous === sha256 ? "unchanged_observation" : "content_changed" : "first_observation";
      }
    } catch { /* Fixed status only; never persist raw source bodies or exception URLs. */ }
    records.push({ ...source, status, httpStatus, sha256 });
  }
  const reviewOverdue = !medicaidGuidanceCurrent(options.now);
  const fingerprint = createHash("sha256").update(JSON.stringify({ records, reviewOverdue })).digest("hex");
  return { observedAt: new Date(options.now ?? Date.now()).toISOString(), fingerprint, lastPolicyReview: MEDICAID_GUIDANCE_REVIEWED, reviewOverdue,
    needsReview: reviewOverdue || records.some((record) => record.status !== "unchanged_observation"), records,
    scope: "Source reachability and normalized-content change detection, including publication discovery. A matching hash or HTTP 200 does not approve a policy statement or application path." };
}

async function main() {
  let baseline;
  try { baseline = JSON.parse(await readFile(BASELINE, "utf8")); } catch { baseline = undefined; }
  const report = await watchGuidance({ baseline });
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/guidance-watch-report.json", JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--record-observation")) await writeFile(BASELINE, JSON.stringify({ observedAt: report.observedAt, policyReviewNotRenewed: true, records: report.records.map(({ id, url, sha256 }) => ({ id, url, sha256 })) }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ needsReview: report.needsReview, reviewOverdue: report.reviewOverdue, records: report.records.length, fingerprint: report.fingerprint }));
}
if (process.argv[1]?.endsWith("watch-guidance.ts")) main().catch(() => { console.error("guidance_watch_failed; no policy review or content was changed"); process.exitCode = 1; });
