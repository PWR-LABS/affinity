/**
 * Live, read-only inventory of [affinity.] Medicaid handoffs against the CMS
 * state contact directory. A matching URL or HTTP 2xx is not proof that a
 * person can finish an application; differences and blocked probes need review.
 *
 * No user profiles, API keys, or patient data are sent by this command.
 */
import { STATE_MEDICAID_RESOURCES } from "@/lib/medicaid/states";

const CMS_DIRECTORY = "https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip";
const PROBE_TIMEOUT_MS = 8_000;
const CONCURRENCY = 4;

export function parseCmsEnrollmentLinks(html: string): Map<string, string> {
  const headings = [...html.matchAll(/<h3\s+id="([A-Z]{2})">/g)];
  const links = new Map<string, string>();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const section = html.slice(heading.index, headings[index + 1]?.index ?? html.length);
    const match = section.match(/<a\s+href="([^"]+)"[^>]*>Enrollment<\/a>/i);
    if (match) links.set(heading[1], match[1].replaceAll("&amp;", "&"));
  }
  return links;
}

export function sameDestination(left: string, right: string): boolean {
  const a = new URL(left);
  const b = new URL(right);
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "")
    && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "")
    && a.search === b.search;
}

interface Probe {
  httpStatus: number | null;
  finalUrl: string | null;
  error: string | null;
}

async function probe(url: string): Promise<Probe> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      headers: { "user-agent": "Mozilla/5.0 (compatible; affinity-handoff-audit/1.0)" },
    });
    await response.body?.cancel();
    return { httpStatus: response.status, finalUrl: response.url, error: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    // Avoid printing exception messages, which can echo the requested URL.
    return { httpStatus: null, finalUrl: null, error: name };
  }
}

async function main(): Promise<void> {
  const fetchedAt = new Date().toISOString();
  const directoryResponse = await fetch(CMS_DIRECTORY, { signal: AbortSignal.timeout(20_000) });
  if (!directoryResponse.ok) throw new Error(`CMS directory returned HTTP ${directoryResponse.status}`);
  const cmsLinks = parseCmsEnrollmentLinks(await directoryResponse.text());
  const missing = STATE_MEDICAID_RESOURCES.filter((row) => !cmsLinks.has(row.code));
  if (missing.length) throw new Error(`CMS enrollment links missing for ${missing.map((row) => row.code).join(", ")}`);

  const rows: Array<Record<string, unknown>> = new Array(STATE_MEDICAID_RESOURCES.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < STATE_MEDICAID_RESOURCES.length) {
      const index = cursor++;
      const resource = STATE_MEDICAID_RESOURCES[index];
      const cmsEnrollmentUrl = cmsLinks.get(resource.code)!;
      rows[index] = {
        code: resource.code,
        state: resource.state,
        appUrl: resource.applyUrl,
        cmsEnrollmentUrl,
        cmsSameDestination: sameDestination(resource.applyUrl, cmsEnrollmentUrl),
        ...await probe(resource.applyUrl),
      };
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const reachable = rows.filter((row) => typeof row.httpStatus === "number" && row.httpStatus >= 200 && row.httpStatus < 300).length;
  const sameAsCms = rows.filter((row) => row.cmsSameDestination).length;
  console.log(JSON.stringify({
    evaluatedAt: fetchedAt,
    cmsDirectory: CMS_DIRECTORY,
    cmsDirectoryHttpStatus: directoryResponse.status,
    scope: "Link inventory and HTTP probe only; not application completion, eligibility, or human-use validation",
    counts: { total: rows.length, cmsSameDestination: sameAsCms, cmsDifferent: rows.length - sameAsCms, http2xx: reachable, httpNon2xx: rows.filter((row) => typeof row.httpStatus === "number" && (row.httpStatus < 200 || row.httpStatus >= 300)).length, probeError: rows.filter((row) => row.error).length },
    rows,
  }, null, 2));
}

if (process.argv[1]?.endsWith("eval-medicaid-handoffs.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
