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

test("nppes fixture produces byte-identical allowlist outputs", async () => {
  const work = await makeTempDir("nppes-fixtures-");
  const outPath = join(work, "allowlist.txt");
  const metaPath = join(work, "allowlist.meta.csv");

  const result = await runTsx([
    "nppes-allowlist.ts",
    "--in",
    "fixtures/nppes-sample.csv",
    "--state",
    "OH",
    "--zip-prefixes",
    "440,441",
    "--out",
    outPath,
  ]);
  const summary = parseSummary(result.stderr);

  assert.equal(summary.rows_scanned, 15);
  assert.equal(summary.matched, 8);
  assert.equal(summary.deactivated_skipped, 1);
  await assertSameFile(join(toolRoot, "fixtures/expected-allowlist.txt"), outPath);
  await assertSameFile(join(toolRoot, "fixtures/expected-allowlist.meta.csv"), metaPath);
});

test("nppes entity and taxonomy filters are applied together", async () => {
  const work = await makeTempDir("nppes-filters-");
  const outPath = join(work, "allowlist.txt");

  await runTsx([
    "nppes-allowlist.ts",
    "--in",
    "fixtures/nppes-sample.csv",
    "--state",
    "OH",
    "--zip-prefixes",
    "440,441",
    "--entity-type",
    "1",
    "--taxonomy-prefixes",
    "207R",
    "--out",
    outPath,
  ]);

  assert.deepEqual(await readLines(outPath), ["1000000007", "1000000010"]);
});

test("large repeated NPPES CSV completes under a 128 MB old-space ceiling", { timeout: 600_000 }, async () => {
  const work = await makeTempDir("nppes-memory-");
  try {
    const bigPath = join(work, "npidata-pfile.csv");
    const outPath = join(work, "allowlist.txt");
    const targetBytes = Number(process.env.NPPES_MEMORY_BYTES ?? String(2 * 1024 * 1024 * 1024));
    await writeRepeatedNppesCsv(bigPath, targetBytes);
    const stat = await fs.stat(bigPath);
    assert.ok(stat.size >= targetBytes, `expected generated CSV >= ${targetBytes} bytes; got ${stat.size}`);

    const result = await runNode(
      [
        "--max-old-space-size=128",
        tsxBin,
        "nppes-allowlist.ts",
        "--in",
        bigPath,
        "--state",
        "OH",
        "--zip-prefixes",
        "440,441",
        "--out",
        outPath,
      ],
      { timeoutMs: 600_000 },
    );
    const summary = parseSummary(result.stderr);
    assert.ok(Number(summary.rows_scanned) > 0);
    assert.ok(Number(summary.matched) > 0);
    assert.deepEqual(await readLines(outPath), ["2000000001", "2000000002"]);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("dol5500 fixture produces byte-identical employer output", async () => {
  const work = await makeTempDir("dol5500-fixtures-");
  const outPath = join(work, "employers.ndjson");

  const result = await runTsx([
    "dol5500-employers.ts",
    "--in",
    "fixtures/dol5500-sample.csv",
    "--in",
    "fixtures/dol5500-sf-sample.csv",
    "--out",
    outPath,
  ]);
  const summary = parseSummary(result.stderr);

  assert.equal(summary.rows_scanned, 20);
  assert.equal(summary.kept, 14);
  assert.equal(summary.dropped_non_health, 4);
  assert.equal(summary.dropped_bad_ein, 2);
  assert.equal(summary.employers_emitted, 11);
  await assertSameFile(join(toolRoot, "fixtures/expected-employers.ndjson"), outPath);
});

test("dol5500 --no-health-only includes non-health plans", async () => {
  const work = await makeTempDir("dol5500-no-health-filter-");
  const outPath = join(work, "employers.ndjson");

  const result = await runTsx([
    "dol5500-employers.ts",
    "--in",
    "fixtures/dol5500-sample.csv",
    "--out",
    outPath,
    "--no-health-only",
  ]);
  const summary = parseSummary(result.stderr);
  const records = await readNdjson(outPath);

  assert.equal(summary.dropped_non_health, 0);
  assert.ok(records.some((record) => record.name_norm === "PINE RETIREMENT"));
  assert.ok(records.some((record) => record.name_norm === "HARBOR VISION"));
});

test("large repeated DOL 5500 CSV completes under a 256 MB old-space ceiling", { timeout: 600_000 }, async () => {
  const work = await makeTempDir("dol5500-memory-");
  try {
    const bigPath = join(work, "f_5500_2025_latest.csv");
    const outPath = join(work, "employers.ndjson");
    const targetBytes = Number(process.env.DOL5500_MEMORY_BYTES ?? String(2 * 1024 * 1024 * 1024));
    await writeRepeatedDol5500Csv(bigPath, targetBytes);
    const stat = await fs.stat(bigPath);
    assert.ok(stat.size >= targetBytes, `expected generated CSV >= ${targetBytes} bytes; got ${stat.size}`);

    const result = await runNode(
      [
        "--max-old-space-size=256",
        tsxBin,
        "dol5500-employers.ts",
        "--in",
        bigPath,
        "--out",
        outPath,
      ],
      { timeoutMs: 600_000 },
    );
    const summary = parseSummary(result.stderr);
    const records = await readNdjson(outPath);

    assert.ok(Number(summary.rows_scanned) > 0);
    assert.ok(Number(summary.dropped_non_health) > 0);
    assert.ok(Number(summary.dropped_bad_ein) > 0);
    assert.equal(summary.employers_emitted, 2);
    assert.deepEqual(
      records.map((record) => record.name_norm),
      ["MEMORY CLINIC", "MEMORY MARKET"],
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("partd fixture produces byte-identical formulary and plan outputs", async () => {
  const work = await makeTempDir("partd-fixtures-");
  const outDir = join(work, "out");

  const result = await runTsx(["partd-formulary.ts", "--in", "fixtures", "--out-dir", outDir]);
  const summary = parseSummary(result.stderr);

  assert.equal(summary.formulary_rows, 10);
  assert.equal(summary.formulary_emitted, 9);
  assert.equal(summary.plan_rows, 10);
  assert.equal(summary.plans_emitted, 10);
  assert.equal(summary.missing_yn_values, 5);
  await assertSameFile(join(toolRoot, "fixtures/expected-partd-formulary.ndjson"), join(outDir, "partd-formulary.ndjson"));
  await assertSameFile(join(toolRoot, "fixtures/expected-partd-plans.ndjson"), join(outDir, "partd-plans.ndjson"));
});

test("large repeated Part D formulary file completes under a 512 MB old-space ceiling", { timeout: 600_000 }, async () => {
  const work = await makeTempDir("partd-memory-");
  try {
    const inputDir = join(work, "input");
    const outDir = join(work, "out");
    const bigPath = join(inputDir, "2026 basic drugs formulary sample.txt");
    const planPath = join(inputDir, "2026 plan information sample.txt");
    const targetBytes = Number(process.env.PARTD_MEMORY_BYTES ?? String(2 * 1024 * 1024 * 1024));

    await writeRepeatedPartdFormulary(bigPath, targetBytes);
    await fs.writeFile(
      planPath,
      [
        "CONTRACT_ID|PLAN_ID|SEGMENT_ID|PLAN_NAME|FORMULARY_ID|PREMIUM|DEDUCTIBLE|STATE|COUNTY_CODE|REGION",
        "S9000|001|0|Memory Rx Standard|90001|0|545|OH|39035|",
        "",
      ].join("\n"),
    );
    const stat = await fs.stat(bigPath);
    assert.ok(stat.size >= targetBytes, `expected generated pipe file >= ${targetBytes} bytes; got ${stat.size}`);

    const result = await runNode(
      [
        "--max-old-space-size=512",
        tsxBin,
        "partd-formulary.ts",
        "--in",
        inputDir,
        "--out-dir",
        outDir,
      ],
      { timeoutMs: 600_000 },
    );
    const summary = parseSummary(result.stderr);
    const formulary = await readNdjson(join(outDir, "partd-formulary.ndjson"));
    const plans = await readNdjson(join(outDir, "partd-plans.ndjson"));

    assert.ok(Number(summary.formulary_rows) > 0);
    assert.equal(summary.formulary_emitted, 3);
    assert.equal(summary.plan_rows, 1);
    assert.equal(summary.plans_emitted, 1);
    assert.ok(Number(summary.missing_yn_values) > 0);
    assert.equal(formulary.length, 3);
    assert.equal(plans.length, 1);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("issuer registry fixture produces byte-identical resolved output", async () => {
  const work = await makeTempDir("issuer-registry-fixtures-");
  const outPath = join(work, "issuers.resolved.ndjson");

  const result = await runTsx([
    "issuer-registry.ts",
    "--in",
    "fixtures/issuers-seed-sample.json",
    "--out",
    outPath,
    "--probe-rates",
  ]);
  const summary = parseSummary(result.stderr);

  assert.equal(summary.entries, 4);
  assert.equal(summary.validated, 3);
  assert.equal(summary.reachable, 3);
  assert.equal(summary.unresolved, 1);
  await assertSameFile(join(toolRoot, "fixtures/expected-issuers.resolved.ndjson"), outPath);
});

test("large issuer index full-count completes under a 256 MB old-space ceiling", { timeout: 600_000 }, async () => {
  const work = await makeTempDir("issuer-registry-memory-");
  try {
    const bigPath = join(work, "issuer-index-memory.json");
    const seedPath = join(work, "issuers.seed.json");
    const outPath = join(work, "issuers.resolved.ndjson");
    const targetBytes = Number(process.env.ISSUER_MEMORY_BYTES ?? String(2 * 1024 * 1024 * 1024));
    const expectedFiles = await writeRepeatedIssuerIndex(bigPath, targetBytes);
    await fs.writeFile(
      seedPath,
      JSON.stringify(
        [
          {
            key: "memory",
            legalName: "Memory Health Insurance Company",
            brand: "Memory Health",
            family: "Memory",
            footprint: "national",
            transparencyPageUrl: "https://issuer.example/memory",
            indexUrl: bigPath,
            haveData: true,
            notes: "synthetic large index fixture",
          },
        ],
        null,
        2,
      ),
    );
    const stat = await fs.stat(bigPath);
    assert.ok(stat.size >= targetBytes, `expected generated issuer index >= ${targetBytes} bytes; got ${stat.size}`);

    const result = await runNode(
      [
        "--max-old-space-size=256",
        tsxBin,
        "issuer-registry.ts",
        "--in",
        seedPath,
        "--out",
        outPath,
        "--full-count",
      ],
      { timeoutMs: 600_000 },
    );
    const summary = parseSummary(result.stderr);
    const records = await readNdjson(outPath);

    assert.equal(summary.entries, 1);
    assert.equal(summary.validated, 1);
    assert.equal(summary.reachable, 1);
    assert.equal(records.length, 1);
    assert.equal(records[0].inNetworkFileCount, expectedFiles);
    assert.equal(records[0].countExact, true);
    assert.equal((records[0].sampleFileLocations as unknown[]).length, 3);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("tic-runner tiers, retries failed shards, and resumes completed work", async () => {
  const work = await makeTempDir("tic-runner-");
  const outDir = join(work, "out");
  const source = await fs.readFile(join(toolRoot, "fixtures/tic-in-network-v2-sample.json"));
  const requestCounts = new Map<string, number>();
  const getCounts = new Map<string, number>();

  const server = createServer((request, response) => {
    const path = request.url?.split("?")[0] ?? "/";
    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
    if (request.method === "GET") getCounts.set(path, (getCounts.get(path) ?? 0) + 1);

    const lengths: Record<string, number> = {
      "/runner-fast.json": 120,
      "/runner-retry.json": 180,
      "/runner-large.json": 9999,
      "/runner-small-plan.json": 90,
    };
    if (!(path in lengths)) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (request.method === "HEAD") {
      response.writeHead(200, { "content-length": String(lengths[path]) });
      response.end();
      return;
    }

    if (path === "/runner-retry.json" && (getCounts.get(path) ?? 0) <= 2) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{");
      return;
    }

    response.writeHead(200, { "content-type": "application/json", "content-length": String(source.length) });
    response.end(source);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    const baseUrl = `http://127.0.0.1:${address!.port}`;
    const manifestPath = join(work, "manifest.files.csv");
    await fs.writeFile(
      manifestPath,
      [
        "file_url,file_description,plan_count,content_length_bytes",
        `${baseUrl}/runner-fast.json,fast shard,25,`,
        `${baseUrl}/runner-retry.json,retry shard,12,180`,
        `${baseUrl}/runner-large.json,large shard,30,9999`,
        `${baseUrl}/runner-small-plan.json,small plan count,2,90`,
        "",
      ].join("\n"),
    );

    const result = await runTsx([
      "tic-runner.ts",
      "--manifest",
      manifestPath,
      "--out-dir",
      outDir,
      "--max-bytes",
      "500",
      "--passes",
      "3",
      "--concurrency",
      "1",
    ]);
    const summary = parseSummary(result.stderr);

    assert.equal(summary.candidates, 3);
    assert.equal(summary.tier_a, 2);
    assert.equal(summary.tier_b, 1);
    assert.equal(summary.done, 2);
    assert.equal(summary.failed, 0);
    assert.equal(summary.pairs_total, 6);
    await assertSameText(await expectedFixtureText("expected-runner-tier-a.csv", baseUrl), join(outDir, "tier-a.csv"));
    await assertSameText(await expectedFixtureText("expected-runner-tier-b.csv", baseUrl), join(outDir, "tier-b.csv"));
    await assertExists(join(outDir, "runner-fast.done"));
    await assertExists(join(outDir, "runner-retry.done"));
    assert.equal(getCounts.get("/runner-retry.json"), 3);
    assert.equal(getCounts.get("/runner-large.json") ?? 0, 0);

    const fastGets = getCounts.get("/runner-fast.json") ?? 0;
    const retryGets = getCounts.get("/runner-retry.json") ?? 0;
    const rerun = await runTsx([
      "tic-runner.ts",
      "--manifest",
      manifestPath,
      "--out-dir",
      outDir,
      "--max-bytes",
      "500",
      "--passes",
      "3",
      "--concurrency",
      "1",
    ]);
    const rerunSummary = parseSummary(rerun.stderr);
    assert.equal(rerunSummary.done, 2);
    assert.equal(rerunSummary.failed, 0);
    assert.equal(getCounts.get("/runner-fast.json") ?? 0, fastGets);
    assert.equal(getCounts.get("/runner-retry.json") ?? 0, retryGets);
  } finally {
    server.close();
    await once(server, "close");
  }
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

async function writeRepeatedNppesCsv(path: string, targetBytes: number): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path);
  let written = 0;

  const write = async (chunk: string) => {
    written += Buffer.byteLength(chunk);
    if (!output.write(chunk)) await once(output, "drain");
  };

  const header =
    "NPI,Entity Type Code,Provider Organization Name (Legal Business Name),Provider Last Name (Legal Name),Provider First Name,Provider Business Practice Location Address City Name,Provider Business Practice Location Address State Name,Provider Business Practice Location Address Postal Code,Healthcare Provider Taxonomy Code_1,NPI Deactivation Date,NPI Reactivation Date\n";
  const rows = [
    "2000000001,1,,Memory,Mina,Cleveland,OH,440010000,207Q00000X,,",
    "2000000002,2,Memory Clinic,,,Cleveland,OH,441010000,261Q00000X,,",
    "2000000003,1,,Closed,Cory,Cleveland,OH,440010000,207Q00000X,2025-01-01,",
  ].join("\n");
  const rowBlock = `${rows}\n`;
  let chunk = "";
  while (Buffer.byteLength(chunk) < 1024 * 1024) chunk += rowBlock;

  await write(header);
  while (written < targetBytes) {
    await write(chunk);
  }

  output.end();
  await once(output, "finish");
}

async function writeRepeatedDol5500Csv(path: string, targetBytes: number): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path);
  let written = 0;

  const write = async (chunk: string) => {
    written += Buffer.byteLength(chunk);
    if (!output.write(chunk)) await once(output, "drain");
  };

  const header =
    "FORM_PLAN_YEAR_BEGIN_DATE,PLAN_NAME,SPONSOR_DFE_NAME,SPONS_DFE_MAIL_US_STATE,SPONS_DFE_EIN,TOT_ACT_PARTCP_BOY_CNT,TYPE_WELFARE_BNFT_CODE\n";
  const rows = [
    "2025-01-01,Memory Market Health Plan,THE MEMORY MARKET CO,OH,400000001,1200,4A",
    "2025-01-01,Memory Market Health Plan,Memory Market Company,OH,400000001,900,4A",
    "2025-01-01,Memory Clinic Health Plan,Memory Clinic LLC,OH,400000002,300,4A",
    "2025-01-01,Memory Savings Plan,Memory Savings LLC,OH,400000003,200,2J",
    "2025-01-01,Bad Memory Health Plan,Bad Memory LLC,OH,BAD-EIN,100,4A",
  ].join("\n");
  const rowBlock = `${rows}\n`;
  let chunk = "";
  while (Buffer.byteLength(chunk) < 1024 * 1024) chunk += rowBlock;

  await write(header);
  while (written < targetBytes) {
    await write(chunk);
  }

  output.end();
  await once(output, "finish");
}

async function writeRepeatedPartdFormulary(path: string, targetBytes: number): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path);
  let written = 0;

  const write = async (chunk: string) => {
    written += Buffer.byteLength(chunk);
    if (!output.write(chunk)) await once(output, "drain");
  };

  const header =
    "FORMULARY_ID|FORMULARY_VERSION|CONTRACT_YEAR|RXCUI|NDC|TIER_LEVEL_VALUE|QUANTITY_LIMIT_YN|QUANTITY_LIMIT_AMOUNT|QUANTITY_LIMIT_DAYS|PRIOR_AUTHORIZATION_YN|STEP_THERAPY_YN\n";
  const rows = [
    "90001|1|2026|111111|00000000001|1|Y|30|30|N|N",
    "90001|1|2026|222222|00000000002|2|N|||Y|N",
    "90002|2|2026|333333|00000000003|3||||Y|",
  ].join("\n");
  const rowBlock = `${rows}\n`;
  let chunk = "";
  while (Buffer.byteLength(chunk) < 1024 * 1024) chunk += rowBlock;

  await write(header);
  while (written < targetBytes) {
    await write(chunk);
  }

  output.end();
  await once(output, "finish");
}

async function writeRepeatedIssuerIndex(path: string, targetBytes: number): Promise<number> {
  await fs.mkdir(dirname(path), { recursive: true });
  const output = createWriteStream(path);
  let written = 0;
  let files = 0;
  const pad = "x".repeat(900);

  const write = async (chunk: string) => {
    written += Buffer.byteLength(chunk);
    if (!output.write(chunk)) await once(output, "drain");
  };

  await write(
    '{"reporting_entity_name":"Memory Index Health","reporting_entity_type":"health insurance issuer","reporting_structure":[{"reporting_plans":[],"in_network_files":[',
  );
  while (files < 3 || written < targetBytes) {
    const prefix = files === 0 ? "" : ",";
    const location = `https://issuer.example/rates/memory-${String(files).padStart(8, "0")}.json.gz`;
    await write(`${prefix}{"description":"${pad}","location":"${location}"}`);
    files += 1;
  }
  await write("]}]}\n");

  output.end();
  await once(output, "finish");
  return files;
}

async function assertSameFile(expected: string, actual: string): Promise<void> {
  assert.equal(await fs.readFile(actual, "utf8"), await fs.readFile(expected, "utf8"));
}

async function assertSameText(expected: string, actual: string): Promise<void> {
  assert.equal(await fs.readFile(actual, "utf8"), expected);
}

async function assertExists(path: string): Promise<void> {
  await fs.access(path);
}

async function expectedFixtureText(file: string, baseUrl: string): Promise<string> {
  return (await fs.readFile(join(toolRoot, "fixtures", file), "utf8")).replaceAll("{{BASE_URL}}", baseUrl);
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

async function readLines(path: string): Promise<string[]> {
  const text = await fs.readFile(path, "utf8");
  return text.trim().split("\n").filter(Boolean);
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
