import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getStringArg, parseArgs } from "./lib/streaming.ts";

type SourceMember = {
  name: string;
  open: () => Promise<{ stream: Readable; done?: Promise<void> }>;
};

type SourceFiles = {
  formulary: SourceMember;
  plans: SourceMember;
};

type FormularyColumnKey =
  | "formularyId"
  | "formularyVersion"
  | "contractYear"
  | "rxcui"
  | "ndc"
  | "tier"
  | "quantityLimitYn"
  | "quantityLimitAmount"
  | "quantityLimitDays"
  | "priorAuthorizationYn"
  | "stepTherapyYn";

type PlanColumnKey =
  | "contractId"
  | "planId"
  | "segmentId"
  | "planName"
  | "formularyId"
  | "premium"
  | "deductible";

type GeoColumnKey = "state" | "county_code" | "region";

type ColumnSpec<Key extends string> = {
  key: Key;
  names: string[];
};

type FormularyColumns = Record<FormularyColumnKey, number>;
type PlanColumns = Record<PlanColumnKey, number> & Partial<Record<GeoColumnKey, number>>;

type ScanStats = {
  formularyRows: number;
  planRows: number;
  missingYnValues: number;
};

const execFileAsync = promisify(execFile);

const FORMULARY_COLUMNS: ColumnSpec<FormularyColumnKey>[] = [
  { key: "formularyId", names: ["FORMULARY_ID"] },
  { key: "formularyVersion", names: ["FORMULARY_VERSION"] },
  { key: "contractYear", names: ["CONTRACT_YEAR"] },
  { key: "rxcui", names: ["RXCUI"] },
  { key: "ndc", names: ["NDC"] },
  { key: "tier", names: ["TIER_LEVEL_VALUE"] },
  { key: "quantityLimitYn", names: ["QUANTITY_LIMIT_YN"] },
  { key: "quantityLimitAmount", names: ["QUANTITY_LIMIT_AMOUNT"] },
  { key: "quantityLimitDays", names: ["QUANTITY_LIMIT_DAYS"] },
  { key: "priorAuthorizationYn", names: ["PRIOR_AUTHORIZATION_YN"] },
  { key: "stepTherapyYn", names: ["STEP_THERAPY_YN"] },
];

const PLAN_COLUMNS: ColumnSpec<PlanColumnKey>[] = [
  { key: "contractId", names: ["CONTRACT_ID"] },
  { key: "planId", names: ["PLAN_ID"] },
  { key: "segmentId", names: ["SEGMENT_ID"] },
  { key: "planName", names: ["PLAN_NAME"] },
  { key: "formularyId", names: ["FORMULARY_ID"] },
  { key: "premium", names: ["PREMIUM"] },
  { key: "deductible", names: ["DEDUCTIBLE"] },
];

const GEO_COLUMNS: ColumnSpec<GeoColumnKey>[] = [
  { key: "state", names: ["STATE"] },
  { key: "county_code", names: ["COUNTY_CODE"] },
  { key: "region", names: ["PDP_REGION_CODE", "MA_REGION_CODE", "REGION", "REGION_CODE"] },
];

async function main(): Promise<void> {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const input = getStringArg(args, "in");
  const outDir = getStringArg(args, "out-dir");
  if (!input) throw new Error("missing required --in <zip-or-dir>");
  if (!outDir) throw new Error("missing required --out-dir <dir>");

  const source = await resolveSourceFiles(input);
  const stats: ScanStats = { formularyRows: 0, planRows: 0, missingYnValues: 0 };
  const formulary = new Map<string, string>();
  const plans = new Map<string, string>();

  await scanFormulary(source.formulary, formulary, stats);
  await scanPlans(source.plans, plans, stats);
  await fs.mkdir(outDir, { recursive: true });
  await writeSortedNdjson(join(outDir, "partd-formulary.ndjson"), formulary);
  await writeSortedNdjson(join(outDir, "partd-plans.ndjson"), plans);

  const seconds = Number(((Date.now() - started) / 1000).toFixed(3));
  process.stderr.write(
    `${JSON.stringify({
      formulary_rows: stats.formularyRows,
      formulary_emitted: formulary.size,
      plan_rows: stats.planRows,
      plans_emitted: plans.size,
      missing_yn_values: stats.missingYnValues,
      seconds,
      peak_rss_mb: peakRssMb(),
    })}\n`,
  );
}

async function resolveSourceFiles(input: string): Promise<SourceFiles> {
  const stat = await fs.stat(input).catch(() => undefined);
  if (!stat) throw new Error(`input not found: ${input}`);
  if (stat.isDirectory()) return resolveDirectorySource(input);
  return resolveZipSource(input);
}

async function resolveDirectorySource(root: string): Promise<SourceFiles> {
  const files = await collectFiles(root);
  const formulary = chooseByPatterns(files, ["basic drugs formulary", "partd formulary sample"]);
  const plans = chooseByPatterns(files, ["plan information", "partd plans sample"]);
  return {
    formulary: {
      name: relative(root, formulary),
      open: async () => ({ stream: createReadStream(formulary, { encoding: "utf8" }) }),
    },
    plans: {
      name: relative(root, plans),
      open: async () => ({ stream: createReadStream(plans, { encoding: "utf8" }) }),
    },
  };
}

async function resolveZipSource(zipPath: string): Promise<SourceFiles> {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], { maxBuffer: 64 * 1024 * 1024 }).catch((error) => {
    throw new Error(`unable to list zip members with unzip -Z1: ${error instanceof Error ? error.message : String(error)}`);
  });
  const members = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const formulary = chooseByPatterns(members, ["basic drugs formulary", "partd formulary sample"]);
  const plans = chooseByPatterns(members, ["plan information", "partd plans sample"]);
  return {
    formulary: zipMemberSource(zipPath, formulary),
    plans: zipMemberSource(zipPath, plans),
  };
}

function zipMemberSource(zipPath: string, member: string): SourceMember {
  return {
    name: member,
    open: async () => {
      const child = spawn("unzip", ["-p", zipPath, member], { stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.setEncoding("utf8");
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      const done = new Promise<void>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`unzip -p failed for ${member} with exit ${code}: ${stderr.trim()}`));
        });
      });
      return { stream: child.stdout, done };
    },
  };
}

async function collectFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) found.push(...(await collectFiles(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function chooseByPatterns(names: string[], patterns: string[]): string {
  const matches = names.filter((name) => patterns.some((pattern) => normalizedMemberName(name).includes(pattern)));
  if (matches.length === 0) {
    throw new Error(`missing Part D member matching one of: ${patterns.join(", ")}`);
  }
  return matches.sort((left, right) => left.localeCompare(right))[0];
}

async function scanFormulary(member: SourceMember, records: Map<string, string>, stats: ScanStats): Promise<void> {
  const { stream, done } = await member.open();
  const lineReader = createInterface({ input: stream, crlfDelay: Infinity });

  let columns: FormularyColumns | undefined;
  for await (const line of lineReader) {
    if (!columns) {
      columns = resolveColumns(parsePipeLine(stripBom(line)), FORMULARY_COLUMNS, "Part D basic drugs formulary");
      continue;
    }

    if (line.length === 0) continue;
    stats.formularyRows += 1;

    const parsed = formularyRecord(parsePipeLine(line), columns, stats);
    if (!parsed || records.has(parsed.key)) continue;
    records.set(parsed.key, parsed.line);
  }

  if (!columns) throw new Error(`Part D basic drugs formulary member has no header row: ${member.name}`);
  await done;
}

async function scanPlans(member: SourceMember, records: Map<string, string>, stats: ScanStats): Promise<void> {
  const { stream, done } = await member.open();
  const lineReader = createInterface({ input: stream, crlfDelay: Infinity });

  let columns: PlanColumns | undefined;
  for await (const line of lineReader) {
    if (!columns) {
      columns = resolvePlanColumns(parsePipeLine(stripBom(line)));
      continue;
    }

    if (line.length === 0) continue;
    stats.planRows += 1;

    const parsed = planRecord(parsePipeLine(line), columns);
    if (!parsed || records.has(parsed.key)) continue;
    records.set(parsed.key, parsed.line);
  }

  if (!columns) throw new Error(`Part D plan information member has no header row: ${member.name}`);
  await done;
}

function formularyRecord(
  row: string[],
  columns: FormularyColumns,
  stats: ScanStats,
): { key: string; line: string } | undefined {
  const formularyId = getCell(row, columns.formularyId);
  const rxcui = getCell(row, columns.rxcui);
  if (!formularyId || !rxcui) return undefined;

  const record: Record<string, string | number | boolean> = {
    formulary_id: formularyId,
    contract_year: parseNumber(getCell(row, columns.contractYear)),
    rxcui,
    tier: parseNumber(getCell(row, columns.tier)),
  };

  const priorAuthorization = parseYn(getCell(row, columns.priorAuthorizationYn), stats);
  const stepTherapy = parseYn(getCell(row, columns.stepTherapyYn), stats);
  const quantityLimit = parseYn(getCell(row, columns.quantityLimitYn), stats);
  if (priorAuthorization !== undefined) record.prior_authorization = priorAuthorization;
  if (stepTherapy !== undefined) record.step_therapy = stepTherapy;
  if (quantityLimit !== undefined) record.quantity_limit = quantityLimit;

  const quantityLimitAmount = optionalNumber(getCell(row, columns.quantityLimitAmount));
  const quantityLimitDays = optionalNumber(getCell(row, columns.quantityLimitDays));
  if (quantityLimitAmount !== undefined) record.quantity_limit_amount = quantityLimitAmount;
  if (quantityLimitDays !== undefined) record.quantity_limit_days = quantityLimitDays;

  return { key: `${formularyId}\t${rxcui}`, line: JSON.stringify(record) };
}

function planRecord(row: string[], columns: PlanColumns): { key: string; line: string } | undefined {
  const contractId = getCell(row, columns.contractId);
  const planId = getCell(row, columns.planId);
  const segmentId = getCell(row, columns.segmentId);
  const formularyId = getCell(row, columns.formularyId);
  if (!contractId || !planId || !segmentId || !formularyId) return undefined;

  const record: Record<string, string> = {
    contract_id: contractId,
    plan_id: planId,
    segment_id: segmentId,
    plan_name: getCell(row, columns.planName),
    formulary_id: formularyId,
  };

  const geo = firstGeo(row, columns);
  if (geo) record[geo.key] = geo.value;

  const geoKey = geo ? `${geo.key}\t${geo.value}` : "";
  return {
    key: [contractId, planId, segmentId, formularyId, geoKey].join("\t"),
    line: JSON.stringify(record),
  };
}

function firstGeo(row: string[], columns: PlanColumns): { key: GeoColumnKey; value: string } | undefined {
  for (const key of ["state", "county_code", "region"] as const) {
    const index = columns[key];
    if (index === undefined) continue;
    const value = getCell(row, index);
    if (value) return { key, value };
  }
  return undefined;
}

function resolvePlanColumns(headers: string[]): PlanColumns {
  const columns = resolveColumns(headers, PLAN_COLUMNS, "Part D plan information") as PlanColumns;
  const indexByName = indexHeaders(headers);
  for (const spec of GEO_COLUMNS) {
    const match = spec.names.find((name) => indexByName.has(normalizeHeader(name)));
    if (match) columns[spec.key] = indexByName.get(normalizeHeader(match))!;
  }
  return columns;
}

function resolveColumns<Key extends string>(
  headers: string[],
  specs: ColumnSpec<Key>[],
  label: string,
): Record<Key, number> {
  const indexByName = indexHeaders(headers);
  const columns = {} as Record<Key, number>;
  const missing: string[] = [];

  for (const spec of specs) {
    const match = spec.names.find((name) => indexByName.has(normalizeHeader(name)));
    if (!match) missing.push(spec.names.join(" or "));
    else columns[spec.key] = indexByName.get(normalizeHeader(match))!;
  }

  if (missing.length > 0) {
    throw new Error(`missing required ${label} column(s): ${missing.join(", ")}`);
  }

  return columns;
}

function indexHeaders(headers: string[]): Map<string, number> {
  const indexByName = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!indexByName.has(normalized)) indexByName.set(normalized, index);
  });
  return indexByName;
}

async function writeSortedNdjson(path: string, records: Map<string, string>): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const lines = [...records.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, line]) => line);
  await fs.writeFile(path, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}

function parsePipeLine(line: string): string[] {
  return line.split("|");
}

function parseYn(value: string, stats: ScanStats): boolean | undefined {
  const normalized = value.trim().toUpperCase();
  if (normalized === "Y") return true;
  if (normalized === "N") return false;
  stats.missingYnValues += 1;
  return undefined;
}

function parseNumber(value: string): number {
  const parsed = optionalNumber(value);
  if (parsed === undefined) throw new Error(`invalid numeric Part D value: ${value}`);
  return parsed;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`invalid numeric Part D value: ${value}`);
  return parsed;
}

function getCell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedMemberName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[._/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function peakRssMb(): number {
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
