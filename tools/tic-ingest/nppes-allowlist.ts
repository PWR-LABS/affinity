import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, basename } from "node:path";
import { getStringArg, parseArgs } from "./lib/streaming.ts";

type ColumnKey =
  | "npi"
  | "entityType"
  | "organizationName"
  | "lastName"
  | "firstName"
  | "city"
  | "state"
  | "postalCode"
  | "taxonomy1"
  | "deactivationDate"
  | "reactivationDate";

type ColumnSpec = {
  key: ColumnKey;
  name: string;
};

type MatchedProvider = {
  npi: string;
  entityType: string;
  name: string;
  taxonomy1: string;
  city: string;
  zip5: string;
};

const REQUIRED_COLUMNS: ColumnSpec[] = [
  { key: "npi", name: "NPI" },
  { key: "entityType", name: "Entity Type Code" },
  { key: "organizationName", name: "Provider Organization Name (Legal Business Name)" },
  { key: "lastName", name: "Provider Last Name (Legal Name)" },
  { key: "firstName", name: "Provider First Name" },
  { key: "city", name: "Provider Business Practice Location Address City Name" },
  { key: "state", name: "Provider Business Practice Location Address State Name" },
  { key: "postalCode", name: "Provider Business Practice Location Address Postal Code" },
  { key: "taxonomy1", name: "Healthcare Provider Taxonomy Code_1" },
  { key: "deactivationDate", name: "NPI Deactivation Date" },
  { key: "reactivationDate", name: "NPI Reactivation Date" },
];

async function main(): Promise<void> {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const input = getStringArg(args, "in");
  const state = getStringArg(args, "state");
  const zipPrefixes = parseCsvArg(getStringArg(args, "zip-prefixes")).map(onlyDigits).filter(Boolean);
  const entityType = getStringArg(args, "entity-type") ?? "both";
  const taxonomyPrefixes = parseCsvArg(getStringArg(args, "taxonomy-prefixes")).map((value) => value.toUpperCase());
  const out = getStringArg(args, "out") ?? "allowlist.txt";
  const metaOut = getStringArg(args, "meta-out") ?? defaultMetaPath(out);

  if (!input) throw new Error("missing required --in <path>");
  if (!state) throw new Error("missing required --state <XX>");
  if (zipPrefixes.length === 0) throw new Error("missing required --zip-prefixes <csv>");
  if (!["1", "2", "both"].includes(entityType)) {
    throw new Error("--entity-type must be one of: 1, 2, both");
  }

  const result = await scanNppesCsv(input, {
    state: state.toUpperCase(),
    zipPrefixes,
    entityType,
    taxonomyPrefixes,
  });

  await writeOutputs(out, metaOut, result.providers);

  const seconds = Number(((Date.now() - started) / 1000).toFixed(3));
  process.stderr.write(
    `${JSON.stringify({
      rows_scanned: result.rowsScanned,
      matched: result.matched,
      deactivated_skipped: result.deactivatedSkipped,
      seconds,
    })}\n`,
  );
}

async function scanNppesCsv(
  input: string,
  filters: {
    state: string;
    zipPrefixes: string[];
    entityType: string;
    taxonomyPrefixes: string[];
  },
): Promise<{
  rowsScanned: number;
  matched: number;
  deactivatedSkipped: number;
  providers: Map<string, MatchedProvider>;
}> {
  const lineReader = createInterface({
    input: createReadStream(input, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let columns: Record<ColumnKey, number> | undefined;
  let rowsScanned = 0;
  let matched = 0;
  let deactivatedSkipped = 0;
  const providers = new Map<string, MatchedProvider>();

  for await (const line of lineReader) {
    if (!columns) {
      columns = resolveColumns(parseCsvLine(stripBom(line)));
      continue;
    }

    if (line.length === 0) continue;

    rowsScanned += 1;
    const row = parseCsvLine(line);
    const deactivationDate = getCell(row, columns.deactivationDate);
    const reactivationDate = getCell(row, columns.reactivationDate);
    if (deactivationDate && !reactivationDate) {
      deactivatedSkipped += 1;
      continue;
    }

    const rowState = getCell(row, columns.state).toUpperCase();
    if (rowState !== filters.state) continue;

    const zipDigits = onlyDigits(getCell(row, columns.postalCode));
    if (!filters.zipPrefixes.some((prefix) => zipDigits.startsWith(prefix))) continue;

    const rowEntityType = getCell(row, columns.entityType);
    if (filters.entityType !== "both" && rowEntityType !== filters.entityType) continue;

    const taxonomy1 = getCell(row, columns.taxonomy1).toUpperCase();
    if (
      filters.taxonomyPrefixes.length > 0 &&
      !filters.taxonomyPrefixes.some((prefix) => taxonomy1.startsWith(prefix))
    ) {
      continue;
    }

    const npi = getCell(row, columns.npi);
    if (!/^\d{10}$/.test(npi)) continue;

    matched += 1;
    if (providers.has(npi)) continue;

    providers.set(npi, {
      npi,
      entityType: rowEntityType,
      name: providerName(row, columns, rowEntityType),
      taxonomy1,
      city: getCell(row, columns.city),
      zip5: zipDigits.slice(0, 5),
    });
  }

  if (!columns) throw new Error("input CSV is missing a header row");

  return { rowsScanned, matched, deactivatedSkipped, providers };
}

function resolveColumns(headers: string[]): Record<ColumnKey, number> {
  const indexByName = new Map<string, number>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (!indexByName.has(normalized)) indexByName.set(normalized, index);
  });

  const missing: string[] = [];
  const columns = {} as Record<ColumnKey, number>;
  for (const spec of REQUIRED_COLUMNS) {
    const index = indexByName.get(normalizeHeader(spec.name));
    if (index === undefined) missing.push(spec.name);
    else columns[spec.key] = index;
  }

  if (missing.length > 0) {
    throw new Error(`missing required NPPES column(s): ${missing.join(", ")}`);
  }

  return columns;
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

async function writeOutputs(out: string, metaOut: string, providers: Map<string, MatchedProvider>): Promise<void> {
  await fs.mkdir(dirname(out), { recursive: true });
  await fs.mkdir(dirname(metaOut), { recursive: true });
  const sorted = [...providers.values()].sort((left, right) => left.npi.localeCompare(right.npi));

  await fs.writeFile(out, sorted.map((provider) => provider.npi).join("\n") + (sorted.length > 0 ? "\n" : ""));

  const metaLines = [
    "npi,entity_type,name,taxonomy_1,city,zip5",
    ...sorted.map((provider) =>
      [
        provider.npi,
        provider.entityType,
        provider.name,
        provider.taxonomy1,
        provider.city,
        provider.zip5,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  await fs.writeFile(metaOut, `${metaLines.join("\n")}\n`);
}

function providerName(row: string[], columns: Record<ColumnKey, number>, entityType: string): string {
  if (entityType === "2") return getCell(row, columns.organizationName);
  const last = getCell(row, columns.lastName);
  const first = getCell(row, columns.firstName);
  return [last, first].filter(Boolean).join(", ");
}

function getCell(row: string[], index: number): string {
  return (row[index] ?? "").trim();
}

function parseCsvArg(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function defaultMetaPath(out: string): string {
  const file = basename(out);
  if (file.toLowerCase().endsWith(".txt")) {
    return join(dirname(out), `${file.slice(0, -4)}.meta.csv`);
  }
  return `${out}.meta.csv`;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
