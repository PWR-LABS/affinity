import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import {
  getBooleanArg,
  getStringArg,
  isScalarToken,
  JsonPathTracker,
  JsonValueCollector,
  openDecodedInput,
  parseArgs,
  parseJsonTokens,
  pathMatches,
  scalarFromToken,
} from "./lib/streaming.ts";

type ReportingPlan = {
  plan_name?: unknown;
  plan_id_type?: unknown;
  plan_id?: unknown;
  plan_market_type?: unknown;
};

type InNetworkFile = {
  description?: unknown;
  location?: unknown;
};

type ReportingStructure = {
  reporting_plans?: unknown;
  in_network_files?: unknown;
};

type ManifestRow = {
  fileUrl: string;
  fileDescription: string;
  planName: string;
  planIdType: string;
  planId: string;
  planMarketType: string;
  reportingEntity: string;
};

type FileRow = {
  fileUrl: string;
  fileDescription: string;
  planKeys: Set<string>;
  contentLengthBytes?: string;
};

const REPORTING_STRUCTURE_PATH = ["reporting_structure", "*"];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = getStringArg(args, "in");
  const out = getStringArg(args, "out") ?? "manifest.csv";
  const planRegex = getStringArg(args, "plan-regex");
  const state = getStringArg(args, "state");
  const maxFilesRaw = getStringArg(args, "max-files");
  const includeHead = getBooleanArg(args, "head");

  if (!input) throw new Error("missing required --in <url|path>");

  const options = {
    planRegex: planRegex ? new RegExp(planRegex, "i") : undefined,
    stateRegex: state ? stateTokenRegex(state) : undefined,
    maxFiles: maxFilesRaw ? Number(maxFilesRaw) : undefined,
  };

  const result = await parseManifest(input, options);
  if (includeHead) await fillHeadSizes(result.files);
  await writeManifest(out, result.rows);
  await writeFilesManifest(out, result.files, includeHead);

  process.stderr.write(
    `${JSON.stringify({
      structures_seen: result.structuresSeen,
      distinct_files: result.files.size,
      distinct_plans: result.distinctPlans.size,
      rows_written: result.rows.length,
    })}\n`,
  );
}

async function parseManifest(
  input: string,
  options: {
    planRegex?: RegExp;
    stateRegex?: RegExp;
    maxFiles?: number;
  },
): Promise<{
  rows: ManifestRow[];
  files: Map<string, FileRow>;
  distinctPlans: Set<string>;
  structuresSeen: number;
}> {
  const opened = await openDecodedInput(input);
  if (!opened.stream) throw new Error(`unable to open input: ${input}`);

  const tracker = new JsonPathTracker();
  let structureCollector: JsonValueCollector | undefined;
  let reportingEntity = "";
  let structuresSeen = 0;
  const rowKeys = new Set<string>();
  const rows: ManifestRow[] = [];
  const files = new Map<string, FileRow>();
  const distinctPlans = new Set<string>();

  await parseJsonTokens(opened.stream, (token) => {
    const hadCollector = Boolean(structureCollector);
    if (structureCollector) {
      structureCollector.push(token);
      if (structureCollector.done) {
        structuresSeen += 1;
        addStructureRows(
          structureCollector.value as ReportingStructure,
          reportingEntity,
          options,
          rowKeys,
          rows,
          files,
          distinctPlans,
        );
        structureCollector = undefined;
      }
    }

    if (token.name === "startObject") {
      const path = tracker.pathForStart();
      if (!hadCollector && pathMatches(path, REPORTING_STRUCTURE_PATH)) {
        structureCollector = new JsonValueCollector();
        structureCollector.push(token);
      }
      tracker.start("object");
      return;
    }

    if (token.name === "startArray") {
      tracker.start("array");
      return;
    }

    if (token.name === "endObject" || token.name === "endArray") {
      tracker.end();
      return;
    }

    if (token.name === "keyValue") {
      tracker.key(token.value);
      return;
    }

    if (isScalarToken(token)) {
      const path = tracker.pathForValue();
      const value = scalarFromToken(token);
      if (typeof value === "string" && pathMatches(path, ["reporting_entity_name"])) {
        reportingEntity = value;
      }
      tracker.value();
    }
  });

  rows.sort((left, right) => {
    const byUrl = left.fileUrl.localeCompare(right.fileUrl);
    if (byUrl !== 0) return byUrl;
    return manifestRowSortKey(left).localeCompare(manifestRowSortKey(right));
  });

  return { rows, files, distinctPlans, structuresSeen };
}

function addStructureRows(
  structure: ReportingStructure,
  reportingEntity: string,
  options: {
    planRegex?: RegExp;
    stateRegex?: RegExp;
    maxFiles?: number;
  },
  rowKeys: Set<string>,
  rows: ManifestRow[],
  files: Map<string, FileRow>,
  distinctPlans: Set<string>,
): void {
  if (!Array.isArray(structure.reporting_plans) || !Array.isArray(structure.in_network_files)) return;

  const plans = structure.reporting_plans as ReportingPlan[];
  const inNetworkFiles = structure.in_network_files as InNetworkFile[];
  for (const file of inNetworkFiles) {
    const fileUrl = normalizeText(file.location);
    if (!fileUrl) continue;

    const fileDescription = normalizeText(file.description);
    const existingFile = files.get(fileUrl);
    if (!existingFile && options.maxFiles !== undefined && files.size >= options.maxFiles) continue;

    const fileRow =
      existingFile ??
      {
        fileUrl,
        fileDescription,
        planKeys: new Set<string>(),
      };
    files.set(fileUrl, fileRow);

    for (const plan of plans) {
      const row: ManifestRow = {
        fileUrl,
        fileDescription,
        planName: normalizeText(plan.plan_name),
        planIdType: normalizeText(plan.plan_id_type),
        planId: normalizeText(plan.plan_id),
        planMarketType: normalizeText(plan.plan_market_type),
        reportingEntity,
      };

      if (options.planRegex && !options.planRegex.test(row.planName)) continue;
      if (options.stateRegex) {
        const haystack = `${row.planName} ${row.fileDescription} ${row.fileUrl}`;
        if (!options.stateRegex.test(haystack)) continue;
      }

      const rowKey = [
        row.fileUrl,
        row.fileDescription,
        row.planName,
        row.planIdType,
        row.planId,
        row.planMarketType,
        row.reportingEntity,
      ].join("\u0000");
      if (rowKeys.has(rowKey)) continue;

      rowKeys.add(rowKey);
      rows.push(row);
      const planKey = `${row.planIdType}|${row.planId}|${row.planMarketType}|${row.planName}`;
      distinctPlans.add(planKey);
      fileRow.planKeys.add(planKey);
    }
  }
}

function manifestRowSortKey(row: ManifestRow): string {
  return [
    row.fileDescription,
    row.planName,
    row.planIdType,
    row.planId,
    row.planMarketType,
    row.reportingEntity,
  ].join("\u0000");
}

async function fillHeadSizes(files: Map<string, FileRow>): Promise<void> {
  await Promise.all(
    [...files.values()].map(async (file) => {
      if (!/^https?:\/\//i.test(file.fileUrl)) {
        file.contentLengthBytes = "";
        return;
      }

      try {
        const response = await openDecodedInput(file.fileUrl, { method: "HEAD", tolerate404: true });
        file.contentLengthBytes = response.headers?.get("content-length") ?? "";
      } catch {
        file.contentLengthBytes = "";
      }
    }),
  );
}

async function writeManifest(out: string, rows: ManifestRow[]): Promise<void> {
  await fs.mkdir(dirname(out), { recursive: true });
  const lines = [
    "file_url,file_description,plan_name,plan_id_type,plan_id,plan_market_type,reporting_entity",
    ...rows.map((row) =>
      [
        row.fileUrl,
        row.fileDescription,
        row.planName,
        row.planIdType,
        row.planId,
        row.planMarketType,
        row.reportingEntity,
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  await fs.writeFile(out, `${lines.join("\n")}\n`);
}

async function writeFilesManifest(out: string, files: Map<string, FileRow>, includeHead: boolean): Promise<void> {
  const fileOut = join(dirname(out), "manifest.files.csv");
  const rows = [...files.values()].sort((left, right) => left.fileUrl.localeCompare(right.fileUrl));
  const header = includeHead
    ? "file_url,file_description,plan_count,content_length_bytes"
    : "file_url,file_description,plan_count";
  const lines = [
    header,
    ...rows.map((row) => {
      const fields = [row.fileUrl, row.fileDescription, String(row.planKeys.size)];
      if (includeHead) fields.push(row.contentLengthBytes ?? "");
      return fields.map(csvEscape).join(",");
    }),
  ];
  await fs.writeFile(fileOut, `${lines.join("\n")}\n`);
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function stateTokenRegex(state: string): RegExp {
  const escaped = state.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[-_\\s])${escaped}(?=$|[-_\\s])`, "i");
}

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
