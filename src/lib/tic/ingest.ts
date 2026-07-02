/**
 * TiC ingest parsing — the pure half of the commercial network-membership loader (S4).
 *
 * Consumes the two artifacts the `tools/tic-ingest` pipeline produces:
 *   - `manifest.csv` (from `toc-manifest`): one row per (in-network file, reporting plan).
 *   - `<shard>.ndjson` (from `tic-extract`): one line per (npi, tin) membership in that file.
 *
 * Everything here is pure/streaming-friendly (line in → record out) so it unit-tests without fs or a
 * database; `scripts/tic-load.ts` owns I/O + Prisma writes. No negotiated-rate data ever passes
 * through this layer — the index is membership only, per doctrine.
 */

export interface TicManifestRow {
  fileUrl: string;
  fileDescription: string;
  planName: string;
  planIdType: string;
  planId: string;
  planMarketType: string;
  reportingEntity: string;
}

export interface TicMembershipLine {
  npi: string;
  tinType: string;
  tinValue: string;
  fileUrl: string;
  reportingEntity: string;
  /** The file's own last_updated_on (YYYY-MM-DD), when present. */
  lastUpdatedOn?: string;
  /** Structural mode the extractor detected: "v1" | "v2". */
  schema?: string;
}

/** Minimal RFC-4180 CSV line splitter — quoted fields may contain commas and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

const MANIFEST_HEADER = "file_url,file_description,plan_name,plan_id_type,plan_id,plan_market_type,reporting_entity";

/** Parse one manifest.csv data line (pass the header line to detect + skip it → null). */
export function parseManifestLine(line: string): TicManifestRow | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === MANIFEST_HEADER) return null;
  const cols = splitCsvLine(trimmed);
  if (cols.length < 7 || !cols[0]) return null;
  return {
    fileUrl: cols[0],
    fileDescription: cols[1],
    planName: cols[2],
    planIdType: cols[3],
    planId: cols[4],
    planMarketType: cols[5],
    reportingEntity: cols[6],
  };
}

/** Parse one tic-extract NDJSON line. Malformed/blank lines → null (callers count skips). */
export function parseMembershipLine(line: string): TicMembershipLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const npi = typeof obj.npi === "string" ? obj.npi : undefined;
  const tinValue = typeof obj.tin_value === "string" ? obj.tin_value : undefined;
  const fileUrl = typeof obj.file_url === "string" ? obj.file_url : undefined;
  if (!npi || !tinValue || !fileUrl) return null;
  return {
    npi,
    tinType: typeof obj.tin_type === "string" ? obj.tin_type : "unknown",
    tinValue,
    fileUrl,
    reportingEntity: typeof obj.reporting_entity === "string" ? obj.reporting_entity : "unknown",
    lastUpdatedOn: typeof obj.last_updated_on === "string" ? obj.last_updated_on : undefined,
    schema: typeof obj.schema === "string" ? obj.schema : undefined,
  };
}

export interface TicFilePlans {
  reportingEntity: string;
  plans: Array<{ planName: string; planIdType: string; planId: string; planMarketType: string }>;
}

/** Group manifest rows by file URL, deduping identical plan links. */
export function groupManifestByFile(rows: TicManifestRow[]): Map<string, TicFilePlans> {
  const byFile = new Map<string, TicFilePlans>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.fileUrl}|${r.planIdType}|${r.planId}|${r.planName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = byFile.get(r.fileUrl) ?? { reportingEntity: r.reportingEntity, plans: [] };
    entry.plans.push({ planName: r.planName, planIdType: r.planIdType, planId: r.planId, planMarketType: r.planMarketType });
    byFile.set(r.fileUrl, entry);
  }
  return byFile;
}
