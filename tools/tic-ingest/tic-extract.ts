import { createReadStream, createWriteStream, promises as fs, type WriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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

type Metadata = {
  reportingEntity: string;
  lastUpdatedOn: string;
  version: string;
};

type ExtractCounters = {
  candidatePairs: number;
  zeroNpiDropped: number;
  tinInNpiDropped: number;
  remoteRefsFetched: number;
  remoteRefs404: number;
};

type CompletedUnits = {
  v2Groups: number;
  rootReferences: number;
  usedReferences: number;
};

type ExtractCheckpoint = {
  format: 2;
  identity: string;
  parseComplete: boolean;
  sawProviderReferences: boolean;
  metadata: Metadata;
  completed: CompletedUnits;
  counters: ExtractCounters;
  inputBytes: number;
};

type WorkPaths = ReturnType<typeof makeWorkPaths>;

type ParseProgress = {
  phase: string;
  bytesRead: number;
  totalBytes: number;
  candidatePairs: number;
  completedUnits: number;
};

type CounterDelta = Pick<ExtractCounters, "candidatePairs" | "zeroNpiDropped" | "tinInNpiDropped">;

type ActiveRootReference = {
  ordinal: number;
  sequence: string;
  depth: number;
  skipped: boolean;
  id: string;
  location: string;
  hasInlineGroups: boolean;
  delta: CounterDelta;
};

type GroupCollector = {
  collector: JsonValueCollector;
  target: "v2" | "v1";
  root?: ActiveRootReference;
};

type V1FinalizeResult = {
  pairsPath: string;
  counters: CounterDelta;
};

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
  input_mb: number;
  candidate_pairs: number;
  resumed: boolean;
  replayed_units: number;
};

export type RunExtractOptions = {
  input: string;
  out: string;
  allowlistPath?: string;
  progress?: boolean;
  workDir?: string;
  keepWork?: boolean;
  fresh?: boolean;
  sortMemory?: string;
  checkpointIntervalMs?: number;
  checkpointUnitInterval?: number;
  signal?: AbortSignal;
};

const ROOT_PROVIDER_REFERENCE_PATH = ["provider_references", "*"];
const ROOT_PROVIDER_REFERENCES_ARRAY_PATH = ["provider_references"];
const ROOT_PROVIDER_GROUPS_ARRAY_PATH = ["provider_references", "*", "provider_groups"];
const ROOT_PROVIDER_GROUP_PATH = ["provider_references", "*", "provider_groups", "*"];
const ROOT_PROVIDER_GROUP_ID_PATH = ["provider_references", "*", "provider_group_id"];
const ROOT_PROVIDER_LOCATION_PATH = ["provider_references", "*", "location"];
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
const EMPTY_DELTA: CounterDelta = {
  candidatePairs: 0,
  zeroNpiDropped: 0,
  tinInNpiDropped: 0,
};

export async function runExtract(options: RunExtractOptions): Promise<ExtractSummary> {
  const started = Date.now();
  const allowlist = await readAllowlist(options.allowlistPath);
  const identity = await buildInputIdentity(options.input, allowlist.hash);
  const workDir = options.workDir ?? `${options.out}.work`;
  const paths = makeWorkPaths(workDir);
  const prepared = await prepareWorkspace(paths, identity, options.fresh === true);
  const checkpoint = prepared.checkpoint;
  const replayedUnits = unitCount(checkpoint.completed);
  const resumed = prepared.loaded && (replayedUnits > 0 || checkpoint.parseComplete);
  const sortMemory = validateSortMemory(options.sortMemory ?? "64M");
  const progressState: ParseProgress = {
    phase: checkpoint.parseComplete ? "finalize" : "parse",
    bytesRead: checkpoint.parseComplete ? checkpoint.inputBytes : 0,
    totalBytes: 0,
    candidatePairs: checkpoint.counters.candidatePairs,
    completedUnits: replayedUnits,
  };
  const progress =
    options.progress === false ? undefined : startProgress(() => progressLine(progressState));

  try {
    if (!checkpoint.parseComplete) {
      await clearDerivedFiles(paths);
      await runParse(options, allowlist.values, paths, checkpoint, progressState);
    }

    throwIfAborted(options.signal);
    progressState.phase = "finalize";
    const schema: "v1" | "v2" = checkpoint.sawProviderReferences ? "v1" : "v2";
    let candidatePairsPath = paths.v2PairsRaw;
    let counters: CounterDelta = {
      candidatePairs: checkpoint.counters.candidatePairs,
      zeroNpiDropped: checkpoint.counters.zeroNpiDropped,
      tinInNpiDropped: checkpoint.counters.tinInNpiDropped,
    };

    if (schema === "v1") {
      const v1 = await finalizeV1(paths, sortMemory, options.signal);
      candidatePairsPath = v1.pairsPath;
      counters = v1.counters;
    }

    const finalPairs = await canonicalizePairs(candidatePairsPath, paths, sortMemory, options.signal);
    const emitted = await writeFinalNdjson(
      finalPairs,
      options.out,
      options.input,
      checkpoint.metadata,
      schema,
      options.signal,
    );
    const seconds = Number(((Date.now() - started) / 1000).toFixed(3));
    const summary: ExtractSummary = {
      files: 1,
      npis_emitted: emitted.npis,
      pairs_emitted: emitted.pairs,
      zero_npi_dropped: counters.zeroNpiDropped,
      tin_in_npi_dropped: counters.tinInNpiDropped,
      remote_refs_fetched: checkpoint.counters.remoteRefsFetched,
      remote_refs_404: checkpoint.counters.remoteRefs404,
      schema,
      seconds,
      peak_rss_mb: peakRssMb(),
      input_mb: Number((checkpoint.inputBytes / 1024 / 1024).toFixed(3)),
      candidate_pairs: counters.candidatePairs,
      resumed,
      replayed_units: resumed ? replayedUnits : 0,
    };

    if (!options.keepWork) await fs.rm(workDir, { recursive: true, force: true });
    return summary;
  } finally {
    if (progress) clearInterval(progress);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = getStringArg(args, "in");
  const out = getStringArg(args, "out") ?? "providers.ndjson";
  const allowlistPath = getStringArg(args, "allowlist");

  if (!input) throw new Error("missing required --in <url|path>");

  const controller = new AbortController();
  const stop = (signal: string) => controller.abort(new Error(`received ${signal}`));
  const onSigint = () => stop("SIGINT");
  const onSigterm = () => stop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    const summary = await runExtract({
      input,
      out,
      allowlistPath,
      workDir: getStringArg(args, "work-dir"),
      keepWork: getBooleanArg(args, "keep-work"),
      fresh: getBooleanArg(args, "fresh"),
      sortMemory: getStringArg(args, "sort-memory"),
      signal: controller.signal,
    });
    process.stderr.write(`${JSON.stringify(summary)}\n`);
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

async function runParse(
  options: RunExtractOptions,
  allowlist: Set<string> | undefined,
  paths: WorkPaths,
  checkpoint: ExtractCheckpoint,
  progress: ParseProgress,
): Promise<void> {
  await fs.mkdir(paths.root, { recursive: true });
  const writers = {
    v2Pairs: await SpoolWriter.open(paths.v2PairsRaw, true),
    v1IdMap: await SpoolWriter.open(paths.v1IdMapRaw, true),
    v1Groups: await SpoolWriter.open(paths.v1GroupsRaw, true),
    v1Used: await SpoolWriter.open(paths.v1UsedRaw, true),
    v1Stats: await SpoolWriter.open(paths.v1StatsRaw, true),
  };
  const allWriters = Object.values(writers);
  const tracker = new JsonPathTracker();
  let depth = 0;
  let groupCollector: GroupCollector | undefined;
  let activeRoot: ActiveRootReference | undefined;
  let seenV2Groups = 0;
  let seenRootReferences = 0;
  let seenUsedReferences = 0;
  let lastCheckpointAt = Date.now();
  let unitsAtCheckpoint = unitCount(checkpoint.completed);
  const checkpointIntervalMs = Math.max(250, options.checkpointIntervalMs ?? 10_000);
  const checkpointUnitInterval = Math.max(1, options.checkpointUnitInterval ?? 100_000);

  const syncCheckpoint = async () => {
    await Promise.all(allWriters.map((writer) => writer.sync()));
    checkpoint.inputBytes = progress.bytesRead;
    await saveCheckpoint(paths.checkpoint, checkpoint);
    lastCheckpointAt = Date.now();
    unitsAtCheckpoint = unitCount(checkpoint.completed);
  };

  const finishResumeUnit = (pending?: void | Promise<void>): void | Promise<void> => {
    const currentUnits = unitCount(checkpoint.completed);
    const due =
      currentUnits - unitsAtCheckpoint >= checkpointUnitInterval ||
      Date.now() - lastCheckpointAt >= checkpointIntervalMs;
    const aborted = options.signal?.aborted === true;
    progress.completedUnits = currentUnits;
    progress.candidatePairs = checkpoint.counters.candidatePairs;
    if (!pending && !due && !aborted) return;

    return (async () => {
      if (pending) await pending;
      if (due || aborted) await syncCheckpoint();
      if (aborted) throw abortError(options.signal);
    })();
  };

  const spoolCollectedGroup = (
    collector: GroupCollector,
  ): void | Promise<void> => {
    const group = collector.collector.value as ProviderGroup;
    if (collector.target === "v2") {
      const rendered = renderProviderGroup(group, allowlist);
      const pending = rendered.chunk ? writers.v2Pairs.write(rendered.chunk) : undefined;
      addDelta(checkpoint.counters, rendered.delta);
      checkpoint.completed.v2Groups += 1;
      return finishResumeUnit(pending);
    }

    const root = collector.root;
    if (!root || root.skipped) return;
    const rendered = renderProviderGroup(group, allowlist, root.sequence);
    root.hasInlineGroups = true;
    addDelta(root.delta, rendered.delta);
    return rendered.chunk ? writers.v1Groups.write(rendered.chunk) : undefined;
  };

  const recordUsedReference = (token: JsonToken): void | Promise<void> => {
    seenUsedReferences += 1;
    if (seenUsedReferences <= checkpoint.completed.usedReferences) return;
    const id = normalizeSpoolField(scalarFromToken(token));
    const pending = id ? writers.v1Used.write(`${id}\n`) : undefined;
    checkpoint.completed.usedReferences += 1;
    return finishResumeUnit(pending);
  };

  const finalizeRootReference = (
    root: ActiveRootReference,
  ): void | Promise<void> => {
    if (root.skipped) return;

    if (root.hasInlineGroups) {
      let pending: void | Promise<void>;
      if (root.id) {
        addDelta(checkpoint.counters, root.delta);
        pending = combinePending(
          writers.v1IdMap.write(`${root.id}\t${root.sequence}\n`),
          writers.v1Stats.write(statsLine(root.sequence, root.delta)),
        );
      }
      checkpoint.completed.rootReferences += 1;
      return finishResumeUnit(pending);
    }

    if (!root.location) {
      checkpoint.completed.rootReferences += 1;
      return finishResumeUnit();
    }

    return (async () => {
      const remote = await readRemoteProviderReference(root.location, root.id, options.signal);
      if (remote === "404") {
        checkpoint.counters.remoteRefs404 += 1;
      } else {
        checkpoint.counters.remoteRefsFetched += 1;
        let remoteIndex = 0;
        const remoteDelta = { ...EMPTY_DELTA };
        for (const [remoteId, groups] of remote) {
          remoteIndex += 1;
          const sequence = referenceSequence(root.ordinal, remoteIndex);
          const delta = { ...EMPTY_DELTA };
          await waitFor(writers.v1IdMap.write(`${normalizeSpoolField(remoteId)}\t${sequence}\n`));
          for (const group of groups) {
            const rendered = renderProviderGroup(group, allowlist, sequence);
            addDelta(delta, rendered.delta);
            addDelta(remoteDelta, rendered.delta);
            if (rendered.chunk) await waitFor(writers.v1Groups.write(rendered.chunk));
          }
          await waitFor(writers.v1Stats.write(statsLine(sequence, delta)));
        }
        addDelta(checkpoint.counters, remoteDelta);
      }
      checkpoint.completed.rootReferences += 1;
      await finishResumeUnit();
    })();
  };

  try {
    const opened = await openDecodedInput(options.input, {
      onBytes: (totalBytes) => {
        progress.bytesRead = totalBytes;
      },
      signal: options.signal,
    });
    if (!opened.stream) throw new Error(`unable to open input: ${options.input}`);
    progress.totalBytes = parsePositiveInteger(opened.headers?.get("content-length"));

    await parseJsonTokens(
      opened.stream,
      (token) => {
        let pending: void | Promise<void>;

        if (groupCollector) {
          groupCollector.collector.push(token);
          if (groupCollector.collector.done) {
            const completedCollector = groupCollector;
            groupCollector = undefined;
            pending = spoolCollectedGroup(completedCollector);
          }
        }

        if (token.name === "startObject") {
          const path = tracker.pathForStart();
          if (!groupCollector && pathMatches(path, ROOT_PROVIDER_REFERENCE_PATH)) {
            seenRootReferences += 1;
            activeRoot = {
              ordinal: seenRootReferences,
              sequence: referenceSequence(seenRootReferences, 0),
              depth: depth + 1,
              skipped: seenRootReferences <= checkpoint.completed.rootReferences,
              id: "",
              location: "",
              hasInlineGroups: false,
              delta: { ...EMPTY_DELTA },
            };
          } else if (
            !groupCollector &&
            activeRoot &&
            !activeRoot.skipped &&
            pathMatches(path, ROOT_PROVIDER_GROUP_PATH)
          ) {
            groupCollector = {
              collector: new JsonValueCollector(),
              target: "v1",
              root: activeRoot,
            };
            groupCollector.collector.push(token);
          } else if (!groupCollector && pathMatches(path, V2_PROVIDER_GROUP_PATH)) {
            seenV2Groups += 1;
            if (seenV2Groups > checkpoint.completed.v2Groups) {
              groupCollector = { collector: new JsonValueCollector(), target: "v2" };
              groupCollector.collector.push(token);
            }
          }
          tracker.start("object");
          depth += 1;
          return pending;
        }

        if (token.name === "startArray") {
          const path = tracker.pathForStart();
          if (pathMatches(path, ROOT_PROVIDER_REFERENCES_ARRAY_PATH)) {
            checkpoint.sawProviderReferences = true;
          }
          if (
            activeRoot &&
            !activeRoot.skipped &&
            pathMatches(path, ROOT_PROVIDER_GROUPS_ARRAY_PATH)
          ) {
            activeRoot.hasInlineGroups = true;
          }
          tracker.start("array");
          depth += 1;
          return pending;
        }

        if (token.name === "endObject" || token.name === "endArray") {
          const rootEnding =
            token.name === "endObject" && activeRoot !== undefined && depth === activeRoot.depth;
          const root = rootEnding ? activeRoot : undefined;
          tracker.end();
          depth -= 1;
          if (root) {
            activeRoot = undefined;
            const rootPending = finalizeRootReference(root);
            return combinePending(pending, rootPending);
          }
          return pending;
        }

        if (token.name === "keyValue") {
          tracker.key(token.value);
          return pending;
        }

        if (isScalarToken(token)) {
          const path = tracker.pathForValue();
          captureMetadata(path, token, checkpoint.metadata);
          if (activeRoot && !activeRoot.skipped) {
            if (pathMatches(path, ROOT_PROVIDER_GROUP_ID_PATH)) {
              activeRoot.id = normalizeSpoolField(scalarFromToken(token));
            } else if (pathMatches(path, ROOT_PROVIDER_LOCATION_PATH)) {
              activeRoot.location = normalizeText(scalarFromToken(token));
            }
          }
          if (pathMatches(path, V1_IN_NETWORK_REFERENCE_PATH)) {
            pending = combinePending(pending, recordUsedReference(token));
          }
          tracker.value();
        }

        return pending;
      },
      {
        ignore: (path) => path[path.length - 1] === "negotiated_prices",
      },
    );

    await Promise.all(allWriters.map((writer) => writer.sync()));
    checkpoint.parseComplete = true;
    checkpoint.inputBytes = progress.bytesRead;
    await saveCheckpoint(paths.checkpoint, checkpoint);
  } finally {
    await Promise.allSettled(allWriters.map((writer) => writer.close()));
  }
}

async function finalizeV1(
  paths: WorkPaths,
  sortMemory: string,
  signal?: AbortSignal,
): Promise<V1FinalizeResult> {
  await ensureSorted(paths.v1UsedRaw, paths.v1UsedSorted, paths.root, sortMemory, signal);
  await ensureSorted(paths.v1IdMapRaw, paths.v1IdMapSorted, paths.root, sortMemory, signal);
  await ensureDerived(paths.v1UsedSequencesRaw, async (output) => {
    await mergeSelectedRows(paths.v1UsedSorted, paths.v1IdMapSorted, output, (line) => {
      const tab = line.indexOf("\t");
      return tab < 0 ? "" : line.slice(tab + 1);
    }, signal);
  });
  await ensureSorted(
    paths.v1UsedSequencesRaw,
    paths.v1UsedSequencesSorted,
    paths.root,
    sortMemory,
    signal,
  );
  await ensureSorted(paths.v1GroupsRaw, paths.v1GroupsSorted, paths.root, sortMemory, signal);
  await ensureDerived(paths.v1ResolvedPairs, async (output) => {
    await mergeSelectedRows(
      paths.v1UsedSequencesSorted,
      paths.v1GroupsSorted,
      output,
      (line) => {
        const tab = line.indexOf("\t");
        return tab < 0 ? "" : line.slice(tab + 1);
      },
      signal,
    );
  });

  await ensureSorted(paths.v1StatsRaw, paths.v1StatsSorted, paths.root, sortMemory, signal);
  const counters = await sumSelectedStats(
    paths.v1UsedSequencesSorted,
    paths.v1StatsSorted,
    signal,
  );
  return { pairsPath: paths.v1ResolvedPairs, counters };
}

async function canonicalizePairs(
  candidatePairs: string,
  paths: WorkPaths,
  sortMemory: string,
  signal?: AbortSignal,
): Promise<string> {
  await ensureSorted(candidatePairs, paths.pairsByKey, paths.root, sortMemory, signal);
  await ensureDerived(paths.pairsCanonical, async (output) => {
    const writer = await SpoolWriter.open(output, false);
    let lastKey = "";
    try {
      for await (const line of readLines(paths.pairsByKey)) {
        throwIfAborted(signal);
        const [npi = "", tinValue = "", tinType = ""] = line.split("\t");
        const key = `${npi}\t${tinValue}`;
        if (!npi || !tinValue || !tinType || key === lastKey) continue;
        lastKey = key;
        await waitFor(writer.write(`${npi}\t${tinType}\t${tinValue}\n`));
      }
    } finally {
      await writer.close();
    }
  });
  await ensureSorted(paths.pairsCanonical, paths.pairsFinal, paths.root, sortMemory, signal);
  return paths.pairsFinal;
}

async function writeFinalNdjson(
  pairsPath: string,
  out: string,
  input: string,
  metadata: Metadata,
  schema: "v1" | "v2",
  signal?: AbortSignal,
): Promise<{ pairs: number; npis: number }> {
  await fs.mkdir(dirname(out), { recursive: true });
  const temp = join(dirname(out), `.${basename(out)}.${process.pid}.tmp`);
  await fs.rm(temp, { force: true });
  const writer = await SpoolWriter.open(temp, false);
  let pairs = 0;
  let npis = 0;
  let lastNpi = "";

  try {
    for await (const line of readLines(pairsPath)) {
      if (pairs % 10_000 === 0) throwIfAborted(signal);
      const [npi = "", tinType = "", tinValue = ""] = line.split("\t");
      if (!npi || !tinType || !tinValue) continue;
      if (npi !== lastNpi) {
        lastNpi = npi;
        npis += 1;
      }
      const output = JSON.stringify({
        npi,
        tin_type: tinType,
        tin_value: tinValue,
        file_url: input,
        reporting_entity: metadata.reportingEntity,
        last_updated_on: metadata.lastUpdatedOn,
        schema,
      });
      await waitFor(writer.write(`${output}\n`));
      pairs += 1;
    }
  } catch (error) {
    await writer.close();
    await fs.rm(temp, { force: true });
    throw error;
  }

  await writer.close();
  await fs.rename(temp, out);
  return { pairs, npis };
}

function renderProviderGroup(
  group: ProviderGroup,
  allowlist: Set<string> | undefined,
  prefix?: string,
): { chunk: string; delta: CounterDelta } {
  const delta = { ...EMPTY_DELTA };
  if (!group || typeof group !== "object") return { chunk: "", delta };
  const tin = group.tin;
  if (!tin || typeof tin !== "object" || !Array.isArray(group.npi)) return { chunk: "", delta };

  const tinType = normalizeSpoolField(tin.type).toLowerCase();
  const tinValue = normalizeSpoolField(tin.value);
  if (!tinType || !tinValue) return { chunk: "", delta };

  const lines: string[] = [];
  for (const rawNpi of group.npi) {
    const npi = normalizeText(rawNpi);
    if (npi === "0") {
      delta.zeroNpiDropped += 1;
      continue;
    }
    if (/^\d{9}$/.test(npi)) {
      delta.tinInNpiDropped += 1;
      continue;
    }
    if (!/^\d{10}$/.test(npi)) continue;
    if (tinType === "ein" && npi === tinValue) {
      delta.tinInNpiDropped += 1;
      continue;
    }
    if (allowlist && !allowlist.has(npi)) continue;

    delta.candidatePairs += 1;
    lines.push(prefix ? `${prefix}\t${npi}\t${tinValue}\t${tinType}\n` : `${npi}\t${tinValue}\t${tinType}\n`);
  }
  return { chunk: lines.join(""), delta };
}

async function readRemoteProviderReference(
  location: string,
  fallbackId: string,
  signal?: AbortSignal,
): Promise<Map<string, ProviderGroup[]> | "404"> {
  const opened = await openDecodedInput(location, { tolerate404: true, signal });
  if (!opened.stream) return "404";

  const references = new Map<string, ProviderGroup[]>();
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
        const id = normalizeSpoolField(reference.provider_group_id);
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

  if (references.size === 0 && directGroups.length > 0 && fallbackId) {
    references.set(fallbackId, directGroups);
  }
  return references;
}

async function mergeSelectedRows(
  selectedPath: string,
  rowsPath: string,
  outputPath: string,
  transform: (line: string) => string,
  signal?: AbortSignal,
): Promise<void> {
  const writer = await SpoolWriter.open(outputPath, false);
  const selected = readLines(selectedPath)[Symbol.asyncIterator]();
  let selectedValue = await nextValue(selected);

  try {
    for await (const line of readLines(rowsPath)) {
      throwIfAborted(signal);
      const tab = line.indexOf("\t");
      const key = tab < 0 ? line : line.slice(0, tab);
      while (selectedValue !== undefined && compareC(selectedValue, key) < 0) {
        selectedValue = await nextValue(selected);
      }
      if (selectedValue !== key) continue;
      const value = transform(line);
      if (value) await waitFor(writer.write(`${value}\n`));
    }
  } finally {
    await selected.return?.(undefined);
    await writer.close();
  }
}

async function sumSelectedStats(
  selectedPath: string,
  statsPath: string,
  signal?: AbortSignal,
): Promise<CounterDelta> {
  const total = { ...EMPTY_DELTA };
  const selected = readLines(selectedPath)[Symbol.asyncIterator]();
  let selectedValue = await nextValue(selected);

  try {
    for await (const line of readLines(statsPath)) {
      throwIfAborted(signal);
      const [sequence = "", zero = "0", tin = "0", candidates = "0"] = line.split("\t");
      while (selectedValue !== undefined && compareC(selectedValue, sequence) < 0) {
        selectedValue = await nextValue(selected);
      }
      if (selectedValue !== sequence) continue;
      total.zeroNpiDropped += parsePositiveInteger(zero);
      total.tinInNpiDropped += parsePositiveInteger(tin);
      total.candidatePairs += parsePositiveInteger(candidates);
    }
  } finally {
    await selected.return?.(undefined);
  }
  return total;
}

async function ensureSorted(
  input: string,
  output: string,
  tempDir: string,
  sortMemory: string,
  signal?: AbortSignal,
): Promise<void> {
  if (await exists(output)) return;
  await fs.mkdir(dirname(output), { recursive: true });
  if (!(await exists(input))) await fs.writeFile(input, "");
  const temp = `${output}.${process.pid}.tmp`;
  await fs.rm(temp, { force: true });
  await runProcess(
    "sort",
    ["-u", "-S", sortMemory, "-T", tempDir, "-o", temp, input],
    signal,
  );
  await fs.rename(temp, output);
}

async function ensureDerived(output: string, build: (temp: string) => Promise<void>): Promise<void> {
  if (await exists(output)) return;
  const temp = `${output}.${process.pid}.tmp`;
  await fs.rm(temp, { force: true });
  try {
    await build(temp);
    await fs.rename(temp, output);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

async function runProcess(
  command: string,
  args: string[],
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, LC_ALL: "C" },
    });
    let stderr = "";
    let settled = false;
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolvePromise();
    };

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (signal?.aborted) {
        finish(abortError(signal));
      } else if (code === 0) {
        finish();
      } else {
        finish(new Error(`${command} exited with ${code ?? 1}: ${stderr.trim()}`));
      }
    });
  });
}

class SpoolWriter {
  private streamError: Error | undefined;
  private closed = false;

  private constructor(private readonly stream: WriteStream) {
    stream.on("error", (error) => {
      this.streamError = error;
    });
  }

  static async open(path: string, append: boolean): Promise<SpoolWriter> {
    await fs.mkdir(dirname(path), { recursive: true });
    const stream = createWriteStream(path, { encoding: "utf8", flags: append ? "a" : "w" });
    await once(stream, "open");
    return new SpoolWriter(stream);
  }

  write(chunk: string): void | Promise<void> {
    if (!chunk) return;
    if (this.streamError) throw this.streamError;
    if (this.closed) throw new Error("cannot write to a closed spool");
    if (!this.stream.write(chunk)) {
      return once(this.stream, "drain").then(() => undefined);
    }
  }

  async sync(): Promise<void> {
    if (this.streamError) throw this.streamError;
    if (this.closed) return;
    await new Promise<void>((resolvePromise, reject) => {
      this.stream.write("", (error) => {
        if (error) reject(error);
        else resolvePromise();
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await new Promise<void>((resolvePromise, reject) => {
      this.stream.end((error?: Error | null) => {
        const failure = error ?? this.streamError;
        if (failure) reject(failure);
        else resolvePromise();
      });
    });
  }
}

async function* readLines(path: string): AsyncGenerator<string> {
  const input = createReadStream(path);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line) yield line;
  }
}

async function readAllowlist(
  path: string | undefined,
): Promise<{ values: Set<string> | undefined; hash: string }> {
  if (!path) return { values: undefined, hash: "none" };
  const values = new Set<string>();
  const hash = createHash("sha256");
  for await (const line of readLines(path)) {
    const npi = line.trim();
    if (!npi) continue;
    values.add(npi);
    hash.update(npi);
    hash.update("\n");
  }
  return { values, hash: hash.digest("hex") };
}

async function buildInputIdentity(input: string, allowlistHash: string): Promise<string> {
  let source: Record<string, unknown> = { input };
  if (!/^https?:\/\//i.test(input)) {
    const stat = await fs.stat(input);
    source = {
      input: resolve(input),
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
    };
  }
  return createHash("sha256")
    .update(JSON.stringify({ format: 2, source, allowlistHash }))
    .digest("hex");
}

async function prepareWorkspace(
  paths: WorkPaths,
  identity: string,
  fresh: boolean,
): Promise<{ checkpoint: ExtractCheckpoint; loaded: boolean }> {
  if (fresh) await fs.rm(paths.root, { recursive: true, force: true });
  let checkpoint = fresh ? undefined : await loadCheckpoint(paths.checkpoint);
  if (!checkpoint || checkpoint.identity !== identity || checkpoint.format !== 2) {
    await fs.rm(paths.root, { recursive: true, force: true });
    await fs.mkdir(paths.root, { recursive: true });
    checkpoint = newCheckpoint(identity);
    await saveCheckpoint(paths.checkpoint, checkpoint);
    return { checkpoint, loaded: false };
  }
  return { checkpoint, loaded: true };
}

function newCheckpoint(identity: string): ExtractCheckpoint {
  return {
    format: 2,
    identity,
    parseComplete: false,
    sawProviderReferences: false,
    metadata: { reportingEntity: "", lastUpdatedOn: "", version: "" },
    completed: { v2Groups: 0, rootReferences: 0, usedReferences: 0 },
    counters: {
      candidatePairs: 0,
      zeroNpiDropped: 0,
      tinInNpiDropped: 0,
      remoteRefsFetched: 0,
      remoteRefs404: 0,
    },
    inputBytes: 0,
  };
}

async function loadCheckpoint(path: string): Promise<ExtractCheckpoint | undefined> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8")) as ExtractCheckpoint;
  } catch {
    return undefined;
  }
}

async function saveCheckpoint(path: string, checkpoint: ExtractCheckpoint): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(checkpoint)}\n`);
  await fs.rename(temp, path);
}

function makeWorkPaths(root: string) {
  return {
    root,
    checkpoint: join(root, "checkpoint.json"),
    v2PairsRaw: join(root, "v2-pairs.raw.tsv"),
    v1IdMapRaw: join(root, "v1-id-map.raw.tsv"),
    v1GroupsRaw: join(root, "v1-groups.raw.tsv"),
    v1UsedRaw: join(root, "v1-used.raw.txt"),
    v1StatsRaw: join(root, "v1-stats.raw.tsv"),
    v1UsedSorted: join(root, "v1-used.sorted.txt"),
    v1IdMapSorted: join(root, "v1-id-map.sorted.tsv"),
    v1UsedSequencesRaw: join(root, "v1-used-sequences.raw.txt"),
    v1UsedSequencesSorted: join(root, "v1-used-sequences.sorted.txt"),
    v1GroupsSorted: join(root, "v1-groups.sorted.tsv"),
    v1ResolvedPairs: join(root, "v1-resolved-pairs.tsv"),
    v1StatsSorted: join(root, "v1-stats.sorted.tsv"),
    pairsByKey: join(root, "pairs.by-key.tsv"),
    pairsCanonical: join(root, "pairs.canonical.tsv"),
    pairsFinal: join(root, "pairs.final.tsv"),
  };
}

async function clearDerivedFiles(paths: WorkPaths): Promise<void> {
  await Promise.all(
    [
      paths.v1UsedSorted,
      paths.v1IdMapSorted,
      paths.v1UsedSequencesRaw,
      paths.v1UsedSequencesSorted,
      paths.v1GroupsSorted,
      paths.v1ResolvedPairs,
      paths.v1StatsSorted,
      paths.pairsByKey,
      paths.pairsCanonical,
      paths.pairsFinal,
    ].map((path) => fs.rm(path, { force: true })),
  );
}

function captureMetadata(path: string[], token: JsonToken, metadata: Metadata): void {
  const value = scalarFromToken(token);
  if (typeof value !== "string") return;
  if (pathMatches(path, ["reporting_entity_name"])) metadata.reportingEntity = value;
  if (pathMatches(path, ["last_updated_on"])) metadata.lastUpdatedOn = value;
  if (pathMatches(path, ["version"])) metadata.version = value;
}

function statsLine(sequence: string, delta: CounterDelta): string {
  return `${sequence}\t${delta.zeroNpiDropped}\t${delta.tinInNpiDropped}\t${delta.candidatePairs}\n`;
}

function addDelta(target: CounterDelta, delta: CounterDelta): void {
  target.candidatePairs += delta.candidatePairs;
  target.zeroNpiDropped += delta.zeroNpiDropped;
  target.tinInNpiDropped += delta.tinInNpiDropped;
}

function referenceSequence(rootOrdinal: number, childOrdinal: number): string {
  return `${String(rootOrdinal).padStart(16, "0")}.${String(childOrdinal).padStart(8, "0")}`;
}

function unitCount(completed: CompletedUnits): number {
  return completed.v2Groups + completed.rootReferences + completed.usedReferences;
}

function combinePending(
  first: void | Promise<void>,
  second: void | Promise<void>,
): void | Promise<void> {
  if (!first) return second;
  if (!second) return first;
  return Promise.all([first, second]).then(() => undefined);
}

async function waitFor(pending: void | Promise<void>): Promise<void> {
  if (pending) await pending;
}

async function nextValue(iterator: AsyncIterator<string>): Promise<string | undefined> {
  const next = await iterator.next();
  return next.done ? undefined : next.value;
}

function compareC(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeSpoolField(value: unknown): string {
  return normalizeText(value).replace(/[\t\r\n]/g, " ");
}

function validateSortMemory(value: string): string {
  if (!/^\d+[KMG%]?$/i.test(value)) {
    throw new Error(`invalid --sort-memory value: ${value}`);
  }
  return value;
}

function parsePositiveInteger(value: string | null | undefined): number {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function progressLine(progress: ParseProgress): string {
  const inputMb = (progress.bytesRead / 1024 / 1024).toFixed(1);
  const total = progress.totalBytes > 0 ? `/${(progress.totalBytes / 1024 / 1024).toFixed(1)}` : "";
  return `phase=${progress.phase} rows=${progress.candidatePairs} npis=deferred mb=${inputMb}${total} rss_mb=${Math.round(process.memoryUsage().rss / 1024 / 1024)} checkpoint=${progress.completedUnits}`;
}

function startProgress(getStatus: () => string): NodeJS.Timeout {
  const interval = setInterval(() => {
    process.stderr.write(`${getStatus()}\n`);
  }, 10_000);
  interval.unref();
  return interval;
}

function peakRssMb(): number {
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error("tic-extract aborted");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
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
