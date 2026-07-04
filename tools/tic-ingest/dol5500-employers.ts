import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

type Args = {
  inputs: string[];
  out: string;
  healthOnly: boolean;
};

type ColumnKey = "name" | "ein" | "state" | "planName" | "welfareCode" | "participants" | "planYear";

type ColumnSpec = {
  key: ColumnKey;
  names: string[];
  required?: boolean;
};

type Columns = Record<Exclude<ColumnKey, "planYear">, number> & {
  planYear?: number;
  form: "5500" | "5500-SF";
  participantField: string;
};

type EmployerRow = {
  ein: string;
  name: string;
  name_norm: string;
  state: string;
  plan_name: string;
  participants: number;
  form: "5500" | "5500-SF";
  plan_year: number | null;
};

type ScanStats = {
  rowsScanned: number;
  kept: number;
  droppedNonHealth: number;
  droppedBadEin: number;
};

const COLUMN_SPECS: ColumnSpec[] = [
  { key: "name", names: ["SPONSOR_DFE_NAME", "SF_SPONSOR_NAME"], required: true },
  { key: "ein", names: ["SPONS_DFE_EIN", "SF_SPONS_EIN"], required: true },
  { key: "state", names: ["SPONS_DFE_MAIL_US_STATE", "SF_SPONS_US_STATE"], required: true },
  { key: "planName", names: ["PLAN_NAME", "SF_PLAN_NAME"], required: true },
  { key: "welfareCode", names: ["TYPE_WELFARE_BNFT_CODE", "SF_TYPE_WELFARE_BNFT_CODE"], required: true },
  {
    key: "participants",
    required: true,
    names: [
      // 2025 DOL file layouts use TOT_ACT_PARTCP_BOY_CNT for Form 5500 and
      // SF_TOT_ACT_PARTCP_BOY_CNT for Form 5500-SF. The remaining names are
      // active-participant fallbacks for older or drifted layouts.
      "TOT_ACT_PARTCP_BOY_CNT",
      "SF_TOT_ACT_PARTCP_BOY_CNT",
      "TOT_ACTIVE_PARTCP_CNT",
      "SF_TOT_ACT_PARTCP_EOY_CNT",
    ],
  },
  { key: "planYear", names: ["FORM_PLAN_YEAR_BEGIN_DATE", "FORM_TAX_PRD", "SF_PLAN_YEAR_BEGIN_DATE", "SF_TAX_PRD"] },
];

const CORPORATE_SUFFIXES = new Set([
  "INC",
  "INCORPORATED",
  "LLC",
  "LLP",
  "LP",
  "LTD",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "PC",
  "PLLC",
  "PA",
  "GROUP",
  "HOLDINGS",
  "THE",
]);

async function main(): Promise<void> {
  const started = Date.now();
  const args = parseDolArgs(process.argv.slice(2));
  const employers = new Map<string, EmployerRow>();
  const stats: ScanStats = {
    rowsScanned: 0,
    kept: 0,
    droppedNonHealth: 0,
    droppedBadEin: 0,
  };

  for (const input of args.inputs) {
    await scanFile(input, args.healthOnly, employers, stats);
  }

  await writeOutput(args.out, employers);

  const seconds = Number(((Date.now() - started) / 1000).toFixed(3));
  process.stderr.write(
    `${JSON.stringify({
      rows_scanned: stats.rowsScanned,
      kept: stats.kept,
      dropped_non_health: stats.droppedNonHealth,
      dropped_bad_ein: stats.droppedBadEin,
      employers_emitted: employers.size,
      seconds,
      peak_rss_mb: peakRssMb(),
    })}\n`,
  );
}

async function scanFile(
  input: string,
  healthOnly: boolean,
  employers: Map<string, EmployerRow>,
  stats: ScanStats,
): Promise<void> {
  const lineReader = createInterface({
    input: createReadStream(input, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let columns: Columns | undefined;
  for await (const line of lineReader) {
    if (!columns) {
      columns = resolveColumns(parseCsvLine(stripBom(line)));
      continue;
    }

    if (line.length === 0) continue;
    stats.rowsScanned += 1;

    const row = parseCsvLine(line);
    if (healthOnly && !hasHealthBenefit(getCell(row, columns.welfareCode))) {
      stats.droppedNonHealth += 1;
      continue;
    }

    const ein = onlyDigits(getCell(row, columns.ein));
    if (!/^\d{9}$/.test(ein)) {
      stats.droppedBadEin += 1;
      continue;
    }

    const name = getCell(row, columns.name);
    const nameNorm = normalizeName(name);
    if (!nameNorm) continue;

    const employer: EmployerRow = {
      ein,
      name,
      name_norm: nameNorm,
      state: getCell(row, columns.state),
      plan_name: getCell(row, columns.planName),
      participants: parseInteger(getCell(row, columns.participants)),
      form: columns.form,
      plan_year: columns.planYear === undefined ? null : extractYear(getCell(row, columns.planYear)),
    };

    stats.kept += 1;
    const key = `${ein}|${nameNorm}`;
    const existing = employers.get(key);
    if (!existing || employer.participants > existing.participants) {
      employers.set(key, employer);
    }
  }

  if (!columns) throw new Error(`input CSV is missing a header row: ${input}`);
}

function resolveColumns(headers: string[]): Columns {
  const indexByName = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!indexByName.has(normalized)) indexByName.set(normalized, index);
  });

  const resolved = {} as Columns;
  const missing: string[] = [];

  for (const spec of COLUMN_SPECS) {
    const match = spec.names.find((name) => indexByName.has(normalizeHeader(name)));
    if (!match) {
      if (spec.required) missing.push(spec.names.join(" or "));
      continue;
    }

    if (spec.key === "participants") resolved.participantField = match;
    resolved[spec.key as Exclude<ColumnKey, "planYear">] = indexByName.get(normalizeHeader(match))!;
  }

  if (missing.length > 0) {
    throw new Error(`missing required DOL Form 5500 column(s): ${missing.join(", ")}`);
  }

  resolved.form =
    headers[resolved.name]?.trim().toUpperCase().startsWith("SF_") ||
    headers[resolved.ein]?.trim().toUpperCase().startsWith("SF_")
      ? "5500-SF"
      : "5500";
  return resolved;
}

function parseDolArgs(argv: string[]): Args {
  const inputs: string[] = [];
  let out = "employers.ndjson";
  let healthOnly = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--in") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("missing value for --in");
      inputs.push(value);
      index += 1;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("missing value for --out");
      out = value;
      index += 1;
    } else if (arg === "--health-only") {
      healthOnly = true;
    } else if (arg === "--no-health-only") {
      healthOnly = false;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (inputs.length === 0) throw new Error("missing required --in <path>");
  return { inputs, out, healthOnly };
}

function parseCsvLine(line: string): string[] {
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
      continue;
    }

    if (char === '"') {
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

function normalizeName(name: string): string {
  const tokens = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 1 && CORPORATE_SUFFIXES.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  while (tokens.length > 1 && tokens[0] === "THE") {
    tokens.shift();
  }

  return tokens.join(" ");
}

function hasHealthBenefit(value: string): boolean {
  // DOL welfare codes are 2-char tokens (4A..4U) usually CONCATENATED with no separator
  // (e.g. Kroger's real cell: "4A4B4E4F4G4H4L"); some layouts use commas. Strip separators,
  // then scan 2-char chunks — exact-token matching drops most real health plans.
  const s = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (let i = 0; i + 2 <= s.length; i += 2) {
    if (s.slice(i, i + 2) === "4A") return true;
  }
  return false;
}

async function writeOutput(out: string, employers: Map<string, EmployerRow>): Promise<void> {
  await fs.mkdir(dirname(out), { recursive: true });
  const sorted = [...employers.values()].sort((left, right) => {
    const byName = left.name_norm.localeCompare(right.name_norm);
    if (byName !== 0) return byName;
    return left.ein.localeCompare(right.ein);
  });

  const lines = sorted.map((employer) =>
    JSON.stringify({
      ein: employer.ein,
      name: employer.name,
      name_norm: employer.name_norm,
      state: employer.state,
      plan_name: employer.plan_name,
      participants: employer.participants,
      form: employer.form,
      plan_year: employer.plan_year,
    }),
  );
  await fs.writeFile(out, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}

function getCell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function parseInteger(value: string): number {
  const digits = onlyDigits(value);
  return digits ? Number(digits) : 0;
}

function extractYear(value: string): number | null {
  const match = value.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function peakRssMb(): number {
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
