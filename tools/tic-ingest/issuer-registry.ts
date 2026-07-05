import { createReadStream, promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { createGunzip } from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  getBooleanArg,
  getStringArg,
  isScalarToken,
  JsonPathTracker,
  parseArgs,
  pathMatches,
  scalarFromToken,
} from "./lib/streaming.ts";

type IssuerSeed = {
  key: string;
  legalName: string;
  brand: string;
  family: string;
  footprint: "national" | string[];
  transparencyPageUrl: string;
  indexUrl: string | null;
  haveData: boolean;
  notes: string;
};

type CliOptions = {
  probeRates: boolean;
  fullCount: boolean;
  headOnly: boolean;
};

type SourceOpenResult = {
  stream: Readable | null;
  httpStatus: number | null;
  contentLength: number | null;
  gzip: boolean | null;
  error?: string;
};

type IndexValidation = {
  reportingEntityName: string | null;
  reportingStructures: number | null;
  inNetworkFileCount: number | null;
  countExact: boolean;
  sampleFileLocations: string[];
  error: string | null;
};

type ResolvedIssuer = {
  key: string;
  indexUrl: string | null;
  reachable: boolean;
  httpStatus: number | null;
  contentLength: number | null;
  gzip: boolean | null;
  reportingEntityName: string | null;
  reportingStructures: number | null;
  inNetworkFileCount: number | null;
  countExact: boolean;
  sampleFileLocations: string[];
  rateSchema?: string | null;
  error: string | null;
};

type Summary = {
  entries: number;
  validated: number;
  reachable: number;
  unresolved: number;
};

type JsonToken = {
  name: string;
  value?: unknown;
};

type JsonParserStream = NodeJS.ReadWriteStream & {
  destroy: (error?: Error) => void;
};

const require = createRequire(import.meta.url);
const { parser } = require("stream-json") as { parser: () => JsonParserStream };
const EARLY_STOP = Symbol("early-stop");
const INDEX_SAMPLE_LIMIT = 3;
const HEAD_RANGE_BYTES = 65_536;
const RATE_PROBE_BYTES = 1024 * 1024;
const FULL_COUNT_CONTENT_LENGTH_LIMIT = 1024 * 1024 * 1024;

async function main(): Promise<void> {
  const started = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const input = getStringArg(args, "in");
  const out = getStringArg(args, "out") ?? "issuers.resolved.ndjson";
  const options: CliOptions = {
    probeRates: getBooleanArg(args, "probe-rates"),
    fullCount: getBooleanArg(args, "full-count"),
    headOnly: getBooleanArg(args, "head-only"),
  };

  if (!input) throw new Error("missing required --in <issuers.seed.json>");

  const seeds = await readSeed(input);
  const summary: Summary = { entries: seeds.length, validated: 0, reachable: 0, unresolved: 0 };
  const progress = setInterval(() => {
    process.stderr.write(
      `progress entries=${summary.entries} validated=${summary.validated} reachable=${summary.reachable} unresolved=${summary.unresolved}\n`,
    );
  }, 10_000);
  progress.unref();

  try {
    const results: ResolvedIssuer[] = [];
    for (const seed of seeds.sort((left, right) => left.key.localeCompare(right.key))) {
      const result = await resolveIssuer(seed, options, summary);
      results.push(result);
    }

    await writeResults(out, results, options.probeRates);
  } finally {
    clearInterval(progress);
  }

  const seconds = Number(((Date.now() - started) / 1000).toFixed(3));
  process.stderr.write(`${JSON.stringify({ ...summary, seconds, peak_rss_mb: peakRssMb() })}\n`);
}

async function readSeed(input: string): Promise<IssuerSeed[]> {
  const text = await fs.readFile(localPath(input), "utf8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error("issuer seed must be a JSON array");

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`issuer seed entry ${index} must be an object`);
    const seed = entry as Partial<IssuerSeed>;
    if (!seed.key || typeof seed.key !== "string") throw new Error(`issuer seed entry ${index} is missing key`);
    return {
      key: seed.key,
      legalName: stringField(seed.legalName),
      brand: stringField(seed.brand),
      family: stringField(seed.family),
      footprint: seed.footprint === "national" ? "national" : Array.isArray(seed.footprint) ? seed.footprint : [],
      transparencyPageUrl: stringField(seed.transparencyPageUrl),
      indexUrl: typeof seed.indexUrl === "string" ? seed.indexUrl : null,
      haveData: seed.haveData === true,
      notes: stringField(seed.notes),
    };
  });
}

async function resolveIssuer(seed: IssuerSeed, options: CliOptions, summary: Summary): Promise<ResolvedIssuer> {
  if (!seed.indexUrl) {
    summary.unresolved += 1;
    return unresolvedResult(seed, options.probeRates, "indexUrl unresolved");
  }

  summary.validated += 1;
  let opened: SourceOpenResult;
  try {
    opened = await openSource(seed.indexUrl, options.headOnly ? { rangeBytes: HEAD_RANGE_BYTES } : {});
  } catch (error) {
    return {
      ...baseResult(seed, options.probeRates),
      reachable: false,
      error: errorMessage(error),
    };
  }

  if (!opened.stream) {
    return {
      ...baseResult(seed, options.probeRates),
      reachable: false,
      httpStatus: opened.httpStatus,
      contentLength: opened.contentLength,
      gzip: opened.gzip,
      error: opened.error ?? `HTTP ${opened.httpStatus}`,
    };
  }

  let validation: IndexValidation;
  try {
    const useFullCount =
      options.fullCount &&
      (!/^https?:\/\//i.test(seed.indexUrl) ||
        opened.contentLength === null ||
        opened.contentLength <= FULL_COUNT_CONTENT_LENGTH_LIMIT);
    validation = options.headOnly
      ? await validateIndexHead(opened.stream)
      : await validateIndexStream(opened.stream, useFullCount);
  } catch (error) {
    validation = {
      reportingEntityName: null,
      reportingStructures: null,
      inNetworkFileCount: null,
      countExact: false,
      sampleFileLocations: [],
      error: errorMessage(error),
    };
  }

  const result: ResolvedIssuer = {
    ...baseResult(seed, options.probeRates),
    reachable: true,
    httpStatus: opened.httpStatus,
    contentLength: opened.contentLength,
    gzip: opened.gzip,
    reportingEntityName: validation.reportingEntityName,
    reportingStructures: validation.reportingStructures,
    inNetworkFileCount: validation.inNetworkFileCount,
    countExact: validation.countExact,
    sampleFileLocations: validation.sampleFileLocations,
    error: validation.error,
  };

  if (options.probeRates) {
    result.rateSchema =
      validation.error === null ? await probeSampledRateSchemas(validation.sampleFileLocations) : null;
  }

  summary.reachable += 1;
  return result;
}

async function validateIndexHead(stream: Readable): Promise<IndexValidation> {
  const text = await collectPrefix(stream, HEAD_RANGE_BYTES);
  const match = text.match(/"reporting_entity_name"\s*:\s*"([^"]+)"/);
  return {
    reportingEntityName: match ? match[1] : null,
    reportingStructures: null,
    inNetworkFileCount: null,
    countExact: false,
    sampleFileLocations: [],
    error: match ? null : "not a TiC index",
  };
}

async function validateIndexStream(stream: Readable, fullCount: boolean): Promise<IndexValidation> {
  const tracker = new JsonPathTracker();
  let reportingEntityName: string | null = null;
  let reportingStructures = 0;
  let inNetworkFileCount = 0;
  let catalogIndexCount = 0;
  const sampleFileLocations: string[] = [];
  const catalogSampleFileLocations: string[] = [];

  const stoppedEarly = await parseTokens(stream, (token) => {
    if (token.name === "startObject") {
      const path = tracker.pathForStart();
      if (pathMatches(path, ["reporting_structure", "*"])) reportingStructures += 1;
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
        reportingEntityName = value;
      }
      if (
        typeof value === "string" &&
        value.trim() &&
        pathMatches(path, ["reporting_structure", "*", "in_network_files", "*", "location"])
      ) {
        inNetworkFileCount += 1;
        if (sampleFileLocations.length < INDEX_SAMPLE_LIMIT) sampleFileLocations.push(value);
        if (
          !fullCount &&
          reportingEntityName &&
          reportingStructures > 0 &&
          sampleFileLocations.length >= INDEX_SAMPLE_LIMIT
        ) {
          throw EARLY_STOP;
        }
      }
      if (isCatalogIndexLocation(path, value)) {
        catalogIndexCount += 1;
        if (catalogSampleFileLocations.length < INDEX_SAMPLE_LIMIT) catalogSampleFileLocations.push(value);
        if (!fullCount && catalogSampleFileLocations.length >= INDEX_SAMPLE_LIMIT) {
          throw EARLY_STOP;
        }
      }
      tracker.value();
    }
  });

  const isTicIndex = Boolean(reportingEntityName) && reportingStructures > 0 && inNetworkFileCount > 0;
  if (isTicIndex) {
    return {
      reportingEntityName,
      reportingStructures,
      inNetworkFileCount,
      countExact: fullCount && !stoppedEarly,
      sampleFileLocations,
      error: null,
    };
  }

  const isCatalogIndex = catalogIndexCount > 0;
  return {
    reportingEntityName,
    reportingStructures: isCatalogIndex ? null : reportingStructures,
    inNetworkFileCount: isCatalogIndex ? catalogIndexCount : inNetworkFileCount,
    countExact: fullCount && !stoppedEarly,
    sampleFileLocations: isCatalogIndex ? catalogSampleFileLocations : sampleFileLocations,
    error: isCatalogIndex ? null : "not a TiC index",
  };
}

function isCatalogIndexLocation(path: string[], value: unknown): value is string {
  if (typeof value !== "string") return false;
  const location = value.trim();
  if (!/^https?:\/\//i.test(location)) return false;
  if (!/_index\.json(?:\.gz)?(?:[?#]|$)/i.test(location)) return false;
  return (
    pathMatches(path, ["blobs", "*", "downloadUrl"]) ||
    pathMatches(path, ["*", "url"]) ||
    pathMatches(path, ["files", "*", "url"]) ||
    pathMatches(path, ["mrfs", "*", "files", "*", "url"])
  );
}

async function parseTokens(stream: Readable, onToken: (token: JsonToken) => void): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const jsonParser = parser();
    let settled = false;
    let stoppedEarly = false;

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(stoppedEarly);
    };

    stream.on("error", finish);
    jsonParser.on("error", finish);
    jsonParser.on("end", () => finish());
    jsonParser.on("data", (token: JsonToken) => {
      try {
        onToken(token);
      } catch (error) {
        if (error === EARLY_STOP) {
          stoppedEarly = true;
          stream.destroy();
          jsonParser.destroy();
          finish();
          return;
        }
        stream.destroy();
        jsonParser.destroy(error as Error);
        finish(error);
      }
    });

    stream.pipe(jsonParser);
  });
}

async function probeRateSchema(location: string, depth = 0): Promise<string | null> {
  try {
    const opened = await openSource(location, { rangeBytes: RATE_PROBE_BYTES });
    if (!opened.stream) return null;
    const text = await collectPrefix(opened.stream, RATE_PROBE_BYTES);
    if (text.includes('"provider_references"')) return "v1";
    if (text.includes('"provider_groups"')) return "v2";
    const nestedRateLocation = depth < 2 ? firstNestedRateLocation(text) : null;
    if (nestedRateLocation) return probeRateSchema(nestedRateLocation, depth + 1);
    return "unknown";
  } catch {
    return null;
  }
}

async function probeSampledRateSchemas(locations: string[]): Promise<string | null> {
  let fallback: string | null = null;
  for (const location of locations) {
    const schema = await probeRateSchema(location);
    if (schema === "v1" || schema === "v2") return schema;
    if (schema && fallback === null) fallback = schema;
  }
  return fallback;
}

function firstNestedRateLocation(text: string): string | null {
  const locationPattern = /"location"\s*:\s*"((?:\\.|[^"\\])+)"/g;
  let match: RegExpExecArray | null;
  while ((match = locationPattern.exec(text)) !== null) {
    const location = jsonStringValue(match[1]);
    if (/^https?:\/\//i.test(location)) return location;
  }
  return null;
}

function jsonStringValue(value: string): string {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

async function openSource(input: string, options: { rangeBytes?: number }): Promise<SourceOpenResult> {
  if (/^https?:\/\//i.test(input)) return openHttpSource(input, options);

  const path = localPath(input);
  const stat = await fs.stat(path);
  const stream = createReadStream(path, {
    start: 0,
    end: options.rangeBytes === undefined ? undefined : options.rangeBytes - 1,
  });
  const sniffed = await sniffGzip(stream);
  return {
    stream: sniffed.stream,
    httpStatus: 200,
    contentLength: stat.size,
    gzip: sniffed.gzip,
  };
}

async function openHttpSource(input: string, options: { rangeBytes?: number }): Promise<SourceOpenResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const headers = new Headers({ "accept-encoding": "identity" });
      if (options.rangeBytes !== undefined) headers.set("range", `bytes=0-${options.rangeBytes - 1}`);
      const response = await fetch(input, { redirect: "follow", headers });

      if (response.status >= 500 && attempt < 3) {
        await delay(250 * attempt);
        continue;
      }

      const contentLength = contentLengthFromHeaders(response.headers);
      if (!response.ok) {
        return {
          stream: null,
          httpStatus: response.status,
          contentLength,
          gzip: null,
          error: `HTTP ${response.status}`,
        };
      }

      if (!response.body) {
        return {
          stream: null,
          httpStatus: response.status,
          contentLength,
          gzip: null,
          error: "empty response body",
        };
      }

      const sniffed = await sniffGzip(Readable.fromWeb(response.body as never));
      return {
        stream: sniffed.stream,
        httpStatus: response.status,
        contentLength,
        gzip: sniffed.gzip,
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function sniffGzip(stream: Readable): Promise<{ stream: Readable; gzip: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const settle = (ended: boolean) => {
      if (settled) return;
      settled = true;
      stream.pause();
      cleanup();

      const prefix = Buffer.concat(chunks, length);
      const pass = new PassThrough();
      const gzip = prefix.length >= 2 && prefix[0] === 0x1f && prefix[1] === 0x8b;
      const decoded = gzip ? pass.pipe(createGunzip()) : pass;

      if (prefix.length > 0) pass.write(prefix);
      if (ended) {
        pass.end();
      } else {
        stream.pipe(pass);
        stream.resume();
      }

      resolve({ stream: decoded, gzip });
    };

    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      length += buffer.length;
      if (length >= 2) settle(false);
    };

    const onEnd = () => settle(true);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
  });
}

async function collectPrefix(stream: Readable, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - length;
      chunks.push(buffer.length > remaining ? buffer.subarray(0, remaining) : buffer);
      length += Math.min(buffer.length, remaining);
      if (length >= maxBytes) {
        stream.destroy();
        break;
      }
    }
  } catch (error) {
    if (length === 0) throw error;
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

async function writeResults(out: string, results: ResolvedIssuer[], includeRateSchema: boolean): Promise<void> {
  await fs.mkdir(dirname(out), { recursive: true });
  const lines = results
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((result) => JSON.stringify(orderedResult(result, includeRateSchema)));
  await fs.writeFile(out, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
}

function orderedResult(result: ResolvedIssuer, includeRateSchema: boolean): Record<string, unknown> {
  const record: Record<string, unknown> = {
    key: result.key,
    indexUrl: result.indexUrl,
    reachable: result.reachable,
    httpStatus: result.httpStatus,
    contentLength: result.contentLength,
    gzip: result.gzip,
    reportingEntityName: result.reportingEntityName,
    reportingStructures: result.reportingStructures,
    inNetworkFileCount: result.inNetworkFileCount,
    countExact: result.countExact,
    sampleFileLocations: result.sampleFileLocations,
  };
  if (includeRateSchema) record.rateSchema = result.rateSchema ?? null;
  record.error = result.error;
  return record;
}

function baseResult(seed: IssuerSeed, includeRateSchema: boolean): ResolvedIssuer {
  const result: ResolvedIssuer = {
    key: seed.key,
    indexUrl: seed.indexUrl,
    reachable: false,
    httpStatus: null,
    contentLength: null,
    gzip: null,
    reportingEntityName: null,
    reportingStructures: null,
    inNetworkFileCount: null,
    countExact: false,
    sampleFileLocations: [],
    error: null,
  };
  if (includeRateSchema) result.rateSchema = null;
  return result;
}

function unresolvedResult(seed: IssuerSeed, includeRateSchema: boolean, error: string): ResolvedIssuer {
  return { ...baseResult(seed, includeRateSchema), error };
}

function localPath(input: string): string {
  if (input.startsWith("file://")) {
    try {
      return fileURLToPath(input);
    } catch {
      return resolve(input.slice("file://".length));
    }
  }
  return resolve(input);
}

function contentLengthFromHeaders(headers: Headers): number | null {
  const contentRange = headers.get("content-range");
  const total = contentRange?.match(/\/(\d+)$/)?.[1];
  const value = total ?? headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
