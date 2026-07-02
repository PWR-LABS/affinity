import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createWriteStream, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createGzip, gzipSync } from "node:zlib";
import test from "node:test";

const toolRoot = fileURLToPath(new URL(".", import.meta.url));
const tsxBin = join(toolRoot, "node_modules", ".bin", "tsx");

test("fixture invocations produce byte-identical expected files", async () => {
  const work = await makeTempDir("tic-fixtures-");

  await runTsx(["tic-extract.ts", "--in", "fixtures/tic-in-network-v2-sample.json", "--out", join(work, "out-v2.ndjson")]);
  await assertSameFile(join(toolRoot, "fixtures/expected-v2.ndjson"), join(work, "out-v2.ndjson"));

  await runTsx(["tic-extract.ts", "--in", "fixtures/tic-in-network-v1-sample.json", "--out", join(work, "out-v1.ndjson")]);
  await assertSameFile(join(toolRoot, "fixtures/expected-v1.ndjson"), join(work, "out-v1.ndjson"));

  await runTsx(["toc-manifest.ts", "--in", "fixtures/toc-sample.json", "--out", join(work, "out-manifest.csv")]);
  await assertSameFile(join(toolRoot, "fixtures/expected-manifest.csv"), join(work, "out-manifest.csv"));
});

test("v1 references after in_network are resolved by the second pass", async () => {
  const work = await makeTempDir("tic-v1-reordered-");
  const fixturePath = join(work, "v1-refs-after.json");
  const fixture = JSON.parse(await fs.readFile(join(toolRoot, "fixtures/tic-in-network-v1-sample.json"), "utf8"));
  const reordered = {
    reporting_entity_name: fixture.reporting_entity_name,
    reporting_entity_type: fixture.reporting_entity_type,
    last_updated_on: fixture.last_updated_on,
    version: fixture.version,
    in_network: fixture.in_network,
    provider_references: fixture.provider_references,
  };
  await fs.writeFile(fixturePath, `${JSON.stringify(reordered)}\n`);

  const outPath = join(work, "out.ndjson");
  await runTsx(["tic-extract.ts", "--in", fixturePath, "--out", outPath]);
  const expected = (await fs.readFile(join(toolRoot, "fixtures/expected-v1.ndjson"), "utf8")).replaceAll(
    "fixtures/tic-in-network-v1-sample.json",
    fixturePath,
  );
  assert.equal(await fs.readFile(outPath, "utf8"), expected);
});

test("allowlist filtering emits only matching NPIs", async () => {
  const work = await makeTempDir("tic-allowlist-");
  const allowlist = join(work, "allowlist.txt");
  await fs.writeFile(allowlist, "1770589349\n0000000000\n2222222222\n3333333333\n4444444444\n");

  const outPath = join(work, "out.ndjson");
  const result = await runTsx([
    "tic-extract.ts",
    "--in",
    "fixtures/tic-in-network-v2-sample.json",
    "--allowlist",
    allowlist,
    "--out",
    outPath,
  ]);
  const summary = parseSummary(result.stderr);
  const records = await readNdjson(outPath);
  assert.equal(summary.pairs_emitted, 1);
  assert.deepEqual(
    records.map((record) => record.npi),
    ["1770589349"],
  );
});

test("plain, gzip, and URL inputs are accepted", async () => {
  const work = await makeTempDir("tic-inputs-");
  const source = await fs.readFile(join(toolRoot, "fixtures/tic-in-network-v2-sample.json"));
  const gzipPath = join(work, "tic-in-network-v2-sample.json.gz");
  await fs.writeFile(gzipPath, gzipSync(source));

  const gzipOut = join(work, "gzip.ndjson");
  await runTsx(["tic-extract.ts", "--in", gzipPath, "--out", gzipOut]);
  assert.equal((await readNdjson(gzipOut)).length, 3);

  const server = createServer((request, response) => {
    if (request.url === "/tic.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(source);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const url = `http://127.0.0.1:${address!.port}/tic.json`;
    const urlOut = join(work, "url.ndjson");
    await runTsx(["tic-extract.ts", "--in", url, "--out", urlOut]);
    const records = await readNdjson(urlOut);
    assert.equal(records.length, 3);
    assert.ok(records.every((record) => record.file_url === url));
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("large repeated gzip completes under a 256 MB old-space ceiling", { timeout: 300_000 }, async () => {
  const work = await makeTempDir("tic-memory-");
  const bigPath = join(work, "big-v2.json.gz");
  const allowlist = join(work, "allowlist.txt");
  const outPath = join(work, "out.ndjson");
  await fs.writeFile(allowlist, "1234567893\n1093712345\n1770589349\n0000000000\n2222222222\n");

  const repeatEntries = Number(process.env.TIC_MEMORY_ENTRIES ?? "500000");
  await writeRepeatedV2Fixture(bigPath, repeatEntries);

  const result = await runNode(
    [
      "--max-old-space-size=256",
      tsxBin,
      "tic-extract.ts",
      "--in",
      bigPath,
      "--allowlist",
      allowlist,
      "--out",
      outPath,
    ],
    { timeoutMs: 300_000 },
  );
  const summary = parseSummary(result.stderr);
  assert.equal(summary.schema, "v2");
  assert.equal(summary.pairs_emitted, 3);
  assert.equal((await readNdjson(outPath)).length, 3);
});

async function writeRepeatedV2Fixture(path: string, totalEntries: number): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const fixture = JSON.parse(await fs.readFile(join(toolRoot, "fixtures/tic-in-network-v2-sample.json"), "utf8"));
  const entries = fixture.in_network as unknown[];

  const gzip = createGzip({ level: 1 });
  const output = createWriteStream(path);
  gzip.pipe(output);

  const write = async (chunk: string) => {
    if (!gzip.write(chunk)) await once(gzip, "drain");
  };

  await write(
    JSON.stringify({
      reporting_entity_name: fixture.reporting_entity_name,
      reporting_entity_type: fixture.reporting_entity_type,
      last_updated_on: fixture.last_updated_on,
      version: fixture.version,
    }).replace(/}$/, ',"in_network":['),
  );

  for (let index = 0; index < totalEntries; index += 1) {
    if (index > 0) await write(",");
    await write(JSON.stringify(entries[index % entries.length]));
  }

  await write("]}");
  gzip.end();
  await once(output, "finish");
}

async function assertSameFile(expected: string, actual: string): Promise<void> {
  assert.equal(await fs.readFile(actual, "utf8"), await fs.readFile(expected, "utf8"));
}

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), prefix));
}

async function readNdjson(path: string): Promise<Record<string, unknown>[]> {
  const text = await fs.readFile(path, "utf8");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseSummary(stderr: string): Record<string, unknown> {
  const line = stderr
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  assert.ok(line, `missing summary JSON in stderr:\n${stderr}`);
  return JSON.parse(line);
}

async function runTsx(args: string[], options: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return runCommand(tsxBin, args, options);
}

async function runNode(args: string[], options: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return runCommand(process.execPath, args, options);
}

async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: toolRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill("SIGTERM");
            reject(new Error(`${command} ${args.join(" ")} timed out`));
          }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    });
  });
}
