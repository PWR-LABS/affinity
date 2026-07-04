import { createWriteStream, promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runExtract } from "./tic-extract.ts";

type RunnerOptions = {
  manifest: string;
  outDir: string;
  allowlist?: string;
  maxBytes: number;
  minPlans: number;
  domainFilter?: string;
  passes: number;
  concurrency: number;
};

type ManifestFileRow = {
  fileUrl: string;
  fileDescription: string;
  planCount: number;
  bytes: number;
};

type TierRow = {
  bytes: number;
  planCount: number;
  url: string;
};

type ShardResult = {
  row: TierRow;
  shard: string;
  ok: boolean;
  skipped: boolean;
  pairs: number;
};

type RunnerSummary = {
  candidates: number;
  tier_a: number;
  tier_b: number;
  done: number;
  failed: number;
  pairs_total: number;
  seconds: number;
};

async function main(): Promise<void> {
  const started = Date.now();
  const options = parseRunnerArgs(process.argv.slice(2));
  const summary = await runRunner(options, started);
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  if (summary.failed > 0) process.exitCode = 1;
}

export async function runRunner(options: RunnerOptions, started = Date.now()): Promise<RunnerSummary> {
  await fs.mkdir(options.outDir, { recursive: true });
  const manifestRows = await readManifestFiles(options.manifest);
  await fillMissingBytes(manifestRows);

  const candidates = manifestRows.filter(
    (row) =>
      row.planCount >= options.minPlans &&
      (!options.domainFilter || row.fileUrl.includes(options.domainFilter)),
  );
  const tierA = candidates
    .filter((row) => row.bytes > 0 && row.bytes <= options.maxBytes)
    .map(toTierRow)
    .sort((left, right) => right.planCount - left.planCount || left.url.localeCompare(right.url));
  const tierB = candidates
    .filter((row) => row.bytes > options.maxBytes)
    .map(toTierRow)
    .sort((left, right) => right.bytes - left.bytes || left.url.localeCompare(right.url));

  await writeTierCsv(join(options.outDir, "tier-a.csv"), tierA);
  await writeTierCsv(join(options.outDir, "tier-b.csv"), tierB);

  const pending = new Map(tierA.map((row) => [row.url, row]));
  let pairsTotal = 0;
  let done = 0;

  for (const row of [...pending.values()]) {
    const shard = shardName(row.url);
    if (await exists(join(options.outDir, `${shard}.done`))) {
      pending.delete(row.url);
      done += 1;
    }
  }

  for (let pass = 1; pass <= options.passes && pending.size > 0; pass += 1) {
    const rows = [...pending.values()];
    const results = await mapPool(rows, options.concurrency, (row) => runShard(row, options));
    for (const result of results) {
      if (result.ok || result.skipped) {
        pending.delete(result.row.url);
        done += 1;
        pairsTotal += result.pairs;
      }
    }
  }

  return {
    candidates: candidates.length,
    tier_a: tierA.length,
    tier_b: tierB.length,
    done,
    failed: pending.size,
    pairs_total: pairsTotal,
    seconds: Number(((Date.now() - started) / 1000).toFixed(3)),
  };
}

async function runShard(row: TierRow, options: RunnerOptions): Promise<ShardResult> {
  const shard = shardName(row.url);
  const ndjsonPath = join(options.outDir, `${shard}.ndjson`);
  const donePath = join(options.outDir, `${shard}.done`);
  const logPath = join(options.outDir, `${shard}.log`);

  if (await exists(donePath)) {
    return { row, shard, ok: true, skipped: true, pairs: 0 };
  }

  try {
    const summary = await runExtract({
      input: row.url,
      out: ndjsonPath,
      allowlistPath: options.allowlist,
      progress: false,
    });
    await fs.writeFile(logPath, `${JSON.stringify(summary)}\n`);
    await fs.writeFile(donePath, `${new Date().toISOString()}\n`);
    return { row, shard, ok: true, skipped: false, pairs: summary.pairs_emitted };
  } catch (error) {
    await fs.rm(ndjsonPath, { force: true });
    await fs.writeFile(logPath, `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    return { row, shard, ok: false, skipped: false, pairs: 0 };
  }
}

function parseRunnerArgs(argv: string[]): RunnerOptions {
  const inputs = new Map<string, string>();
  let allowlist: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
    if (name === "allowlist") allowlist = value;
    else inputs.set(name, value);
    index += 1;
  }

  const manifest = inputs.get("manifest");
  const outDir = inputs.get("out-dir");
  if (!manifest) throw new Error("missing required --manifest <manifest.files.csv>");
  if (!outDir) throw new Error("missing required --out-dir <dir>");

  return {
    manifest,
    outDir,
    allowlist,
    maxBytes: Number(inputs.get("max-bytes") ?? "314572800"),
    minPlans: Number(inputs.get("min-plans") ?? "10"),
    domainFilter: inputs.get("domain-filter"),
    passes: Number(inputs.get("passes") ?? "3"),
    concurrency: Number(inputs.get("concurrency") ?? "2"),
  };
}

async function readManifestFiles(path: string): Promise<ManifestFileRow[]> {
  const text = await fs.readFile(path, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((column) => column.trim().toLowerCase());
  const urlIndex = header.indexOf("file_url");
  const descriptionIndex = header.indexOf("file_description");
  const planCountIndex = header.indexOf("plan_count");
  const bytesIndex = header.indexOf("content_length_bytes");
  const missing = [
    ["file_url", urlIndex],
    ["file_description", descriptionIndex],
    ["plan_count", planCountIndex],
  ]
    .filter(([, index]) => index === -1)
    .map(([name]) => name);
  if (missing.length > 0) throw new Error(`missing manifest column(s): ${missing.join(", ")}`);

  return lines.slice(1).flatMap((line) => {
    const cols = splitCsvLine(line);
    const fileUrl = cols[urlIndex]?.trim();
    if (!fileUrl) return [];
    return [
      {
        fileUrl,
        fileDescription: cols[descriptionIndex]?.trim() ?? "",
        planCount: parseInteger(cols[planCountIndex]),
        bytes: bytesIndex >= 0 ? parseInteger(cols[bytesIndex]) : 0,
      },
    ];
  });
}

async function fillMissingBytes(rows: ManifestFileRow[]): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      if (row.bytes > 0 || !/^https?:\/\//i.test(row.fileUrl)) return;
      row.bytes = await headContentLength(row.fileUrl);
    }),
  );
}

async function headContentLength(url: string): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!response.ok) return 0;
    return parseInteger(response.headers.get("content-length") ?? "");
  } catch {
    return 0;
  }
}

async function writeTierCsv(path: string, rows: TierRow[]): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const writer = createWriteStream(path, { encoding: "utf8" });
  writer.write("bytes,plan_count,url\n");
  for (const row of rows) {
    writer.write(`${row.bytes},${row.planCount},${csvEscape(row.url)}\n`);
  }
  await new Promise<void>((resolve, reject) => {
    writer.end(resolve);
    writer.on("error", reject);
  });
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await fn(current));
    }
  });
  await Promise.all(workers);
  return results;
}

function toTierRow(row: ManifestFileRow): TierRow {
  return { bytes: row.bytes, planCount: row.planCount, url: row.fileUrl };
}

function shardName(url: string): string {
  const parsed = new URL(url);
  let name = basename(parsed.pathname);
  name = name.replace(/\.json\.gz$/i, "");
  name = name.replace(/\.(gz|json|zip)$/i, "");
  return name || "shard";
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function parseInteger(value: string | undefined | null): number {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
