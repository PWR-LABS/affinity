import { createWriteStream, promises as fs } from "node:fs";
import { dirname, basename, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  getStringArg,
  isScalarToken,
  JsonPathTracker,
  JsonValueCollector,
  openDecodedInput,
  parseArgs,
  parseJsonTokens,
  pathMatches,
  scalarFromToken,
  type JsonToken,
} from "./lib/streaming.ts";

type ProviderGroup = {
  npi?: unknown;
  tin?: {
    type?: unknown;
    value?: unknown;
  };
};

type ProviderReference = {
  provider_group_id?: unknown;
  provider_groups?: unknown;
  location?: unknown;
};

type OutputPair = {
  npi: string;
  tinType: string;
  tinValue: string;
};

type Metadata = {
  reportingEntity: string;
  lastUpdatedOn: string;
  version: string;
};

type ReferenceTable = Map<string, ProviderGroup[]>;

export type ExtractSummary = {
  files: number;
  npis_emitted: number;
  pairs_emitted: number;
  zero_npi_dropped: number;
  tin_in_npi_dropped: number;
  remote_refs_fetched: number;
  remote_refs_404: number;
  schema: "v1" | "v2";
  seconds: number;
  peak_rss_mb: number;
};

export type RunExtractOptions = {
  input: string;
  out: string;
  allowlistPath?: string;
  progress?: boolean;
};

class ExtractionState {
  pairs = new Map<string, OutputPair>();
  npis = new Set<string>();
  zeroNpiDropped = 0;
  tinInNpiDropped = 0;

  constructor(private readonly allowlist: Set<string> | undefined) {}

  resetOutputCounts(): void {
    this.pairs.clear();
    this.npis.clear();
    this.zeroNpiDropped = 0;
    this.tinInNpiDropped = 0;
  }

  addProviderGroup(group: ProviderGroup): void {
    if (!group || typeof group !== "object") return;

    const tin = group.tin;
    if (!tin || typeof tin !== "object") return;

    const tinType = normalizeText(tin.type).toLowerCase();
    const tinValue = normalizeText(tin.value);
    if (!tinType || !tinValue || !Array.isArray(group.npi)) return;

    for (const rawNpi of group.npi) {
      const npi = normalizeText(rawNpi);
      if (npi === "0") {
        this.zeroNpiDropped += 1;
        continue;
      }

      if (/^\d{9}$/.test(npi)) {
        this.tinInNpiDropped += 1;
        continue;
      }

      if (!/^\d{10}$/.test(npi)) continue;

      if (tinType === "ein" && npi === tinValue) {
        this.tinInNpiDropped += 1;
        continue;
      }

      if (this.allowlist && !this.allowlist.has(npi)) continue;

      const key = `${npi}|${tinValue}`;
      if (!this.pairs.has(key)) {
        this.pairs.set(key, { npi, tinType, tinValue });
        this.npis.add(npi);
      }
    }
  }
}

type FirstPassResult = {
  metadata: Metadata;
  sawProviderReferences: boolean;
  references: ReferenceTable;
  remoteRefsFetched: number;
  remoteRefs404: number;
};

const ROOT_PROVIDER_REFERENCE_PATH = ["provider_references", "*"];
const ROOT_PROVIDER_REFERENCES_ARRAY_PATH = ["provider_references"];
const V2_PROVIDER_GROUP_PATH = [
  "in_network",
  "*",
  "negotiated_rates",
  "*",
  "provider_groups",
  "*",
];
const V1_IN_NETWORK_REFERENCE_PATH = [
  "in_network",
  "*",
  "negotiated_rates",
  "*",
  "provider_references",
  "*",
];

export async function runExtract(options: RunExtractOptions): Promise<ExtractSummary> {
  const started = Date.now();
  const allowlist = options.allowlistPath ? await readAllowlist(options.allowlistPath) : undefined;
  const state = new ExtractionState(allowlist);
  const progress =
    options.progress === false ? undefined : startProgress(() => `rows=${state.pairs.size} npis=${state.npis.size}`);

  let firstPass: FirstPassResult;
  let schema: "v1" | "v2" = "v2";

  try {
    firstPass = await runFirstPass(options.input, state);
    if (firstPass.sawProviderReferences) {
      schema = "v1";
      state.resetOutputCounts();
      await runV1SecondPass(options.input, firstPass.references, state);
    }

    await writeSortedNdjson(options.out, options.input, firstPass.metadata, schema, state.pairs);
  } finally {
    if (progress) clearInterval(progress);
  }

  const seconds = Number(((Date.now() - started) / 1000).toFixed(3));
  return {
    files: 1,
    npis_emitted: state.npis.size,
    pairs_emitted: state.pairs.size,
    zero_npi_dropped: state.zeroNpiDropped,
    tin_in_npi_dropped: state.tinInNpiDropped,
    remote_refs_fetched: firstPass!.remoteRefsFetched,
    remote_refs_404: firstPass!.remoteRefs404,
    schema,
    seconds,
    peak_rss_mb: peakRssMb(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = getStringArg(args, "in");
  const out = getStringArg(args, "out") ?? "providers.ndjson";
  const allowlistPath = getStringArg(args, "allowlist");

  if (!input) throw new Error("missing required --in <url|path>");

  const summary = await runExtract({ input, out, allowlistPath });
  process.stderr.write(`${JSON.stringify(summary)}\n`);
}

async function runFirstPass(input: string, state: ExtractionState): Promise<FirstPassResult> {
  const opened = await openDecodedInput(input);
  if (!opened.stream) throw new Error(`unable to open input: ${input}`);

  const metadata: Metadata = { reportingEntity: "", lastUpdatedOn: "", version: "" };
  const references: ReferenceTable = new Map();
  const remoteFetches: Promise<void>[] = [];
  const tracker = new JsonPathTracker();
  let providerGroupCollector: JsonValueCollector | undefined;
  let providerReferenceCollector: JsonValueCollector | undefined;
  let sawProviderReferences = false;
  let remoteRefsFetched = 0;
  let remoteRefs404 = 0;

  await parseJsonTokens(opened.stream, (token) => {
    const hadCollector = Boolean(providerGroupCollector || providerReferenceCollector);

    if (providerGroupCollector) {
      providerGroupCollector.push(token);
      if (providerGroupCollector.done) {
        state.addProviderGroup(providerGroupCollector.value as ProviderGroup);
        providerGroupCollector = undefined;
      }
    }

    if (providerReferenceCollector) {
      providerReferenceCollector.push(token);
      if (providerReferenceCollector.done) {
        const reference = providerReferenceCollector.value as ProviderReference;
        const promise = recordProviderReference(reference, references).then((status) => {
          if (status === "fetched") remoteRefsFetched += 1;
          if (status === "404") remoteRefs404 += 1;
        });
        remoteFetches.push(promise);
        providerReferenceCollector = undefined;
      }
    }

    if (token.name === "startObject") {
      const path = tracker.pathForStart();
      if (!hadCollector) {
        if (pathMatches(path, ROOT_PROVIDER_REFERENCE_PATH)) {
          providerReferenceCollector = new JsonValueCollector();
          providerReferenceCollector.push(token);
        } else if (!sawProviderReferences && pathMatches(path, V2_PROVIDER_GROUP_PATH)) {
          providerGroupCollector = new JsonValueCollector();
          providerGroupCollector.push(token);
        }
      }
      tracker.start("object");
      return;
    }

    if (token.name === "startArray") {
      const path = tracker.pathForStart();
      if (pathMatches(path, ROOT_PROVIDER_REFERENCES_ARRAY_PATH)) {
        sawProviderReferences = true;
      }
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
      captureMetadata(path, token, metadata);
      tracker.value();
    }
  });

  await Promise.all(remoteFetches);
  return { metadata, sawProviderReferences, references, remoteRefsFetched, remoteRefs404 };
}

async function runV1SecondPass(input: string, references: ReferenceTable, state: ExtractionState): Promise<void> {
  const opened = await openDecodedInput(input);
  if (!opened.stream) throw new Error(`unable to open input: ${input}`);

  const tracker = new JsonPathTracker();

  await parseJsonTokens(opened.stream, (token) => {
    if (token.name === "startObject") {
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
      if (pathMatches(path, V1_IN_NETWORK_REFERENCE_PATH)) {
        const referenceId = normalizeText(scalarFromToken(token));
        const groups = references.get(referenceId);
        if (groups) {
          for (const group of groups) state.addProviderGroup(group);
        }
      }
      tracker.value();
    }
  });
}

async function recordProviderReference(
  reference: ProviderReference,
  references: ReferenceTable,
): Promise<"inline" | "fetched" | "404" | "skipped"> {
  const id = normalizeText(reference.provider_group_id);
  if (!id) return "skipped";

  if (Array.isArray(reference.provider_groups)) {
    references.set(id, reference.provider_groups as ProviderGroup[]);
    return "inline";
  }

  const location = normalizeText(reference.location);
  if (!location) return "skipped";

  const remote = await readRemoteProviderReference(location, id);
  if (remote === "404") return "404";

  for (const [remoteId, groups] of remote) {
    references.set(remoteId, groups);
  }
  return "fetched";
}

async function readRemoteProviderReference(
  location: string,
  fallbackId: string,
): Promise<Map<string, ProviderGroup[]> | "404"> {
  const opened = await openDecodedInput(location, { tolerate404: true });
  if (!opened.stream) return "404";

  const references: ReferenceTable = new Map();
  const directGroups: ProviderGroup[] = [];
  const tracker = new JsonPathTracker();
  let providerReferenceCollector: JsonValueCollector | undefined;
  let providerGroupCollector: JsonValueCollector | undefined;

  await parseJsonTokens(opened.stream, (token) => {
    const hadCollector = Boolean(providerReferenceCollector || providerGroupCollector);

    if (providerReferenceCollector) {
      providerReferenceCollector.push(token);
      if (providerReferenceCollector.done) {
        const reference = providerReferenceCollector.value as ProviderReference;
        const id = normalizeText(reference.provider_group_id);
        if (id && Array.isArray(reference.provider_groups)) {
          references.set(id, reference.provider_groups as ProviderGroup[]);
        }
        providerReferenceCollector = undefined;
      }
    }

    if (providerGroupCollector) {
      providerGroupCollector.push(token);
      if (providerGroupCollector.done) {
        directGroups.push(providerGroupCollector.value as ProviderGroup);
        providerGroupCollector = undefined;
      }
    }

    if (token.name === "startObject") {
      const path = tracker.pathForStart();
      if (!hadCollector) {
        if (pathMatches(path, ROOT_PROVIDER_REFERENCE_PATH)) {
          providerReferenceCollector = new JsonValueCollector();
          providerReferenceCollector.push(token);
        } else if (pathMatches(path, ["provider_groups", "*"])) {
          providerGroupCollector = new JsonValueCollector();
          providerGroupCollector.push(token);
        }
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

    if (isScalarToken(token)) tracker.value();
  });

  if (references.size === 0 && directGroups.length > 0) {
    references.set(fallbackId, directGroups);
  }

  return references;
}

function captureMetadata(path: string[], token: JsonToken, metadata: Metadata): void {
  const value = scalarFromToken(token);
  if (typeof value !== "string") return;

  if (pathMatches(path, ["reporting_entity_name"])) metadata.reportingEntity = value;
  if (pathMatches(path, ["last_updated_on"])) metadata.lastUpdatedOn = value;
  if (pathMatches(path, ["version"])) metadata.version = value;
}

async function readAllowlist(path: string): Promise<Set<string>> {
  const text = await fs.readFile(path, "utf8");
  const allowlist = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const npi = line.trim();
    if (npi) allowlist.add(npi);
  }
  return allowlist;
}

async function writeSortedNdjson(
  out: string,
  input: string,
  metadata: Metadata,
  schema: "v1" | "v2",
  pairs: Map<string, OutputPair>,
): Promise<void> {
  await fs.mkdir(dirname(out), { recursive: true });
  const temp = join(dirname(out), `.${basename(out)}.${process.pid}.unsorted`);
  const writer = createWriteStream(temp, { encoding: "utf8" });

  for (const pair of pairs.values()) {
    const line = JSON.stringify({
      npi: pair.npi,
      tin_type: pair.tinType,
      tin_value: pair.tinValue,
      file_url: input,
      reporting_entity: metadata.reportingEntity,
      last_updated_on: metadata.lastUpdatedOn,
      schema,
    });
    writer.write(`${line}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(resolve);
    writer.on("error", reject);
  });

  await sortFile(temp, out);
  await fs.rm(temp, { force: true });
}

async function sortFile(input: string, output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const writer = createWriteStream(output, { encoding: "utf8" });
    const child = spawn("sort", [input], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let childCode: number | null = null;
    let writerFinished = false;
    let rejected = false;

    const fail = (error: Error) => {
      if (rejected) return;
      rejected = true;
      reject(error);
    };

    const maybeResolve = () => {
      if (rejected || childCode === null || !writerFinished) return;
      if (childCode === 0) resolve();
      else fail(new Error(`sort exited with ${childCode}: ${stderr.trim()}`));
    };

    child.stdout.pipe(writer);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", fail);
    writer.on("error", fail);
    writer.on("finish", () => {
      writerFinished = true;
      maybeResolve();
    });
    child.on("close", (code) => {
      childCode = code ?? 1;
      maybeResolve();
    });
  });
}

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function startProgress(getStatus: () => string): NodeJS.Timeout {
  const interval = setInterval(() => {
    process.stderr.write(`${getStatus()} mb=${Math.round(process.memoryUsage().rss / 1024 / 1024)}\n`);
  }, 10_000);
  interval.unref();
  return interval;
}

function peakRssMb(): number {
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
