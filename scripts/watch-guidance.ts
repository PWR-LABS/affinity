/** Source-change detection only. Observation hashes never count as policy review. */
import { setTimeout as wait } from "node:timers/promises";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { FEDERAL_MEDICAID_CHANGES, MEDICAID_GUIDANCE_REVIEWED, medicaidGuidanceCurrent } from "@/lib/medicaid/federal";
import { FEATURED_MEDICAID_CHANGES } from "@/lib/medicaid/states";

const BASELINE = "src/lib/medicaid/guidance-observations.json";
export const GUIDANCE_FINGERPRINT_VERSION = 2;
const SOURCE_USER_AGENT = "affinity-source-watch/1.0 (+https://github.com/PWR-LABS/affinity)";
// Medicaid.gov declares Crawl-delay: 1. Space all source requests conservatively.
const SOURCE_INTERVAL_MS = 1200;
export const GUIDANCE_SOURCES = [
  ...FEDERAL_MEDICAID_CHANGES.map((source) => ({ id: source.id, url: source.sourceUrl })),
  ...FEATURED_MEDICAID_CHANGES.flatMap((source) => source.sources.map((link, index) => ({ id: `${source.code}-${index}`, url: link.url }))),
  { id: "policy-publication-index", url: "https://www.medicaid.gov/federal-policy-guidance" },
  { id: "state-contact-directory", url: "https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip" },
];

function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (original, entity: string) => {
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] ?? original;
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original;
  });
}

const HTML_TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const LINK_TAG = /<(?:a|area)\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
function attribute(tag: string, name: string) {
  const attrs = tag.replace(/^<\w+\b/, "").replace(/>$/, "");
  for (const match of attrs.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    if (match[1].toLowerCase() === name) return decodeEntities(match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
  return undefined;
}

export function contentFingerprint(bytes: Uint8Array, contentType: string, sourceUrl = "https://source.invalid/") {
  let data: Uint8Array | string = bytes;
  if (/html/i.test(contentType)) {
    const html = new TextDecoder().decode(bytes);
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
    if (!main) throw new Error("source_main_content_missing");
    const content = main.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    const text = decodeEntities(content.replace(HTML_TAG, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 100) throw new Error("source_content_incomplete");
    const document = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    const baseTag = document.match(/<base\b(?:[^>"']|"[^"]*"|'[^']*')*>/i)?.[0];
    const baseHref = baseTag ? attribute(baseTag, "href") : undefined;
    const base = baseHref !== undefined ? new URL(baseHref, sourceUrl).href : sourceUrl;
    const links = [...content.matchAll(LINK_TAG)].flatMap(([tag]) => {
      const target = attribute(tag, "href");
      if (target === undefined) return [];
      try { return [new URL(target, base).href]; } catch { return [target]; }
    });
    data = JSON.stringify({ text, links: [...new Set(links)].sort() });
  } else if (!/pdf/i.test(contentType) || bytes.length < 100) throw new Error("source_type_or_size_unexpected");
  return createHash("sha256").update(`guidance-fingerprint/${GUIDANCE_FINGERPRINT_VERSION}\n`).update(data).digest("hex");
}

export async function watchGuidance(options: { baseline?: { fingerprintVersion?: number; records: Array<{ id: string; sha256: string | null }> }; fetchImpl?: typeof fetch; waitImpl?: (milliseconds: number) => Promise<unknown>; now?: number }) {
  const records = [];
  for (const source of GUIDANCE_SOURCES) {
    if (records.length) await (options.waitImpl ?? wait)(SOURCE_INTERVAL_MS);
    let sha256: string | null = null;
    let status = "network_unavailable";
    let httpStatus: number | null = null;
    try {
      const cmsSource = ["www.medicaid.gov", "www.cms.gov"].includes(new URL(source.url).hostname);
      const response = await (options.fetchImpl ?? fetch)(source.url, { signal: AbortSignal.timeout(15_000), cache: "no-store", headers: { accept: "text/html,application/pdf", ...(cmsSource ? { "user-agent": SOURCE_USER_AGENT } : {}) } });
      httpStatus = response.status;
      status = "http_error";
      if (response.ok) {
        status = "content_unparsed";
        sha256 = contentFingerprint(new Uint8Array(await response.arrayBuffer()), response.headers.get("content-type") ?? "", response.url || source.url);
        const previous = options.baseline?.records.find((record) => record.id === source.id)?.sha256;
        status = previous ? options.baseline?.fingerprintVersion !== GUIDANCE_FINGERPRINT_VERSION ? "baseline_refresh_required"
          : previous === sha256 ? "unchanged_observation" : "content_changed" : "first_observation";
      }
    } catch { /* Fixed status only; never persist raw source bodies or exception URLs. */ }
    records.push({ ...source, status, httpStatus, sha256 });
  }
  const reviewOverdue = !medicaidGuidanceCurrent(options.now);
  const fingerprint = createHash("sha256").update(JSON.stringify({ fingerprintVersion: GUIDANCE_FINGERPRINT_VERSION, records, reviewOverdue })).digest("hex");
  return { observedAt: new Date(options.now ?? Date.now()).toISOString(), fingerprintVersion: GUIDANCE_FINGERPRINT_VERSION,
    baselineVersion: options.baseline?.fingerprintVersion ?? null, fingerprint, lastPolicyReview: MEDICAID_GUIDANCE_REVIEWED, reviewOverdue,
    needsReview: reviewOverdue || records.some((record) => record.status !== "unchanged_observation"), records,
    scope: "Source reachability and normalized-content change detection, including publication discovery. A matching hash or HTTP 200 does not approve a policy statement or application path." };
}

async function main() {
  let baseline;
  try { baseline = JSON.parse(await readFile(BASELINE, "utf8")); } catch { baseline = undefined; }
  const report = await watchGuidance({ baseline });
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/guidance-watch-report.json", JSON.stringify(report, null, 2) + "\n");
  if (process.argv.includes("--record-observation")) await writeFile(BASELINE, JSON.stringify({ observedAt: report.observedAt, fingerprintVersion: GUIDANCE_FINGERPRINT_VERSION, policyReviewNotRenewed: true, records: report.records.map(({ id, url, sha256 }) => ({ id, url, sha256 })) }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ needsReview: report.needsReview, reviewOverdue: report.reviewOverdue, records: report.records.length, fingerprint: report.fingerprint }));
}
if (process.argv[1]?.endsWith("watch-guidance.ts")) main().catch(() => { console.error("guidance_watch_failed; no policy review or content was changed"); process.exitCode = 1; });
