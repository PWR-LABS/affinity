/** Local synthetic benchmark. Dry by default; no production APIs or database writes. */
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hash, models, parseCap, plan, pricingObservedAt, rates, reserve, score, usageMicro, type Response } from "./guru-benchmark/core";

type Row = {
  key: string; family: string; model: string; state: "reserved" | "completed" | "failed";
  reservedMicro: number; startedAt: string; latencyMs?: number; measuredMicro?: number | null;
  responseId?: string; returnedModel?: string; result?: ReturnType<typeof score>; failure?: string;
};
type Ledger = { version: 1; planHash: string; capMicro: number; rows: Row[] };
const args = process.argv.slice(2);
const value = (name: string) => args.find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
const known = ["--live", "--repeats=", "--cap-usd="];
if (args.some(arg => !known.some(k => k.endsWith("=") ? arg.startsWith(k) : arg === k))) throw new Error("Unknown benchmark option");
const jobs = plan(Number(value("--repeats") ?? 2));
const plannedMaximumMicro = jobs.reduce((n, j) => n + j.reserveMicro, 0);
const sourceHash = hash({ jobs, rates, pricingObservedAt });
const manifest = {
  mode: args.includes("--live") ? "live_requested" : "dry_run_no_model_calls",
  models, cases: jobs.length / models.length / Number(value("--repeats") ?? 2),
  requests: jobs.length, repeats: Number(value("--repeats") ?? 2),
  plannedMaximumUsd: plannedMaximumMicro / 1e6, pricingObservedAt, sourceHash,
  families: [...new Set(jobs.map(j => j.item.family))],
  limitations: ["Synthetic text and tool-selection evaluation, not live tool execution", "Human semantic review required", "Voice, vision/OCR and production latency not measured"],
};

async function durableWrite(target: string, value: unknown) {
  const temporary = `${target}.next`;
  const file = await open(temporary, "w", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, target);
  const dir = await open(path.dirname(target), "r");
  try { await dir.sync(); } finally { await dir.close(); }
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null };
}

async function main() {
  if (!args.includes("--live")) { console.log(JSON.stringify(manifest, null, 2)); return; }
  const capMicro = parseCap(value("--cap-usd"));
  if (plannedMaximumMicro > capMicro) throw new Error("Full balanced run exceeds cap; reduce repeats before any request");
  // Price review cannot silently drift across later runs.
  if (Date.now() - Date.parse(pricingObservedAt) > 7 * 86400000) throw new Error("Recheck model pricing before live benchmark");
  const apiKey = process.env.AFFINITY_OPENAI_API_KEY;
  if (!apiKey?.trim()) throw new Error("AFFINITY_OPENAI_API_KEY is not configured; no request sent");
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const root = path.join(repo, "tmp", "guru-benchmark", "pilot-v1");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, "publisher.lock");
  // Fixed pilot identity: restarting cannot reset the shared local budget.
  await mkdir(lock, { mode: 0o700 });
  try {
    const ledgerPath = path.join(root, "ledger.json");
    let ledger: Ledger;
    try { ledger = JSON.parse(await readFile(ledgerPath, "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Invalid benchmark ledger; manual review required");
      ledger = { version: 1, planHash: sourceHash, capMicro, rows: [] };
    }
    if (ledger.version !== 1 || ledger.planHash !== sourceHash || ledger.capMicro !== capMicro || !Array.isArray(ledger.rows)) throw new Error("Benchmark identity changed; preserve ledger and review before retry");
    if (ledger.rows.some(r => r.state !== "completed")) throw new Error("Prior uncertain/failed attempt needs review; no automatic retry or budget reset");
    if (new Set(ledger.rows.map(r => r.key)).size !== ledger.rows.length || ledger.rows.some(r => !jobs.some(j => j.key === r.key && j.reserveMicro === r.reservedMicro))) throw new Error("Ledger identities do not match benchmark");
    await durableWrite(path.join(root, "manifest.json"), manifest);
    for (const job of jobs) {
      if (ledger.rows.some(r => r.key === job.key)) continue;
      reserve(ledger.rows.reduce((n, r) => n + r.reservedMicro, 0), job.reserveMicro, capMicro);
      const row: Row = { key: job.key, family: job.item.family, model: job.model, state: "reserved", reservedMicro: job.reserveMicro, startedAt: new Date().toISOString() };
      ledger.rows.push(row);
      await durableWrite(ledgerPath, ledger); // Persist before dispatch, including ambiguous outcomes.
      const started = performance.now();
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(job.body),
        });
        if (!response.ok) throw new Error(`provider_http_${response.status}`);
        const body = await response.json() as Response;
        row.latencyMs = Math.round(performance.now() - started);
        row.measuredMicro = usageMicro(job.model, body);
        row.responseId = body.id; row.returnedModel = body.model;
        row.result = score(job.item, body);
        // Do not release reservations. Actual cost is reported separately.
        if (row.measuredMicro === null) throw new Error("missing_usage_review_required");
        if (row.measuredMicro > row.reservedMicro) throw new Error("reservation_exceeded_review_required");
        if (body.model && body.model !== job.model && !body.model.startsWith(`${job.model}-`)) throw new Error("unexpected_model_review_required");
        row.state = "completed";
        await durableWrite(ledgerPath, ledger);
        console.log(JSON.stringify({ completed: ledger.rows.length, total: jobs.length, model: job.model, case: job.item.id, passed: row.result.passed }));
      } catch (error) {
        row.state = "failed";
        // Never serialize provider error bodies, request headers or arbitrary exceptions.
        const message = error instanceof Error ? error.message : "";
        row.failure = /^(provider_http_\d+|missing_usage_review_required|reservation_exceeded_review_required|unexpected_model_review_required)$/.test(message) ? message : "transport_or_local_failure_review_required";
        await durableWrite(ledgerPath, ledger);
        throw new Error(row.failure);
      }
    }
    const summary = models.map(model => {
      const rows = ledger.rows.filter(r => r.model === model);
      return { model, completed: rows.length, automatedPassed: rows.filter(r => r.result?.passed).length,
        conservativeUsageUsd: rows.reduce((n, r) => n + (r.measuredMicro ?? 0), 0) / 1e6,
        latency: percentiles(rows.flatMap(r => r.latencyMs === undefined ? [] : [r.latencyMs])),
        families: manifest.families.map(family => {
          const group = rows.filter(r => r.family === family);
          return { family, n: group.length, passed: group.filter(r => r.result?.passed).length };
        }),
      };
    });
    await durableWrite(path.join(root, "report.json"), { ...manifest, summary,
      reservedUsd: ledger.rows.reduce((n, r) => n + r.reservedMicro, 0) / 1e6,
      semanticReview: "pending", modelSelection: "not_decided" });
    // Blind review export deliberately excludes model and time/cost; mapping stays separate.
    await durableWrite(path.join(root, "blind-review.json"), ledger.rows.map((r, i) => ({
      reviewId: hash({ key: r.key, sourceHash }).slice(0, 16),
      caseId: jobs[i].item.id, prompt: jobs[i].item.prompt, evidence: jobs[i].item.evidence,
      response: r.result?.parsed, rubric: jobs[i].item.review,
      assessment: { factualCorrectness: null, evidenceFaithfulness: null, usefulNextStep: null, clarity: null, criticalFailure: null },
    })).sort((a, b) => a.reviewId.localeCompare(b.reviewId)));
    console.log(JSON.stringify({ state: "measured_awaiting_semantic_review", summary }));
  } finally { await rm(lock, { recursive: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Benchmark stopped"); process.exitCode = 1; });
