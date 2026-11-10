import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withExtensionReservation, type ExtensionRequest } from '../scripts/guru-benchmark/extension-ledger';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'affinity-eval-ledger-'));
  const baseline = JSON.stringify({ capMicro: 5_000_000, rows: Array.from({ length: 228 }, (_, i) => ({
    key: `synthetic-${i}`, state: 'completed', reservedMicro: i === 0 ? 4_054_027 : 1,
  })) });
  await writeFile(path.join(root, 'ledger.json'), baseline);
  return { root, baseline, baselineHash: createHash('sha256').update(baseline).digest('hex') };
}
const request = (phase: ExtensionRequest['phase'] = 'held_out'): ExtensionRequest => ({
  requestId: randomUUID(), phase, sourceCommit: 'a'.repeat(40), manifestHash: 'b'.repeat(64),
  requestHash: 'c'.repeat(64), model: 'gpt-6.1-terra',
});

test('eight fixture and ten interactive reservations share one immutable baseline and cap', async () => {
  const f = await fixture(); let calls = 0;
  try {
    for (let i = 0; i < 18; i++) await withExtensionReservation({ ...f, request: request(i < 8 ? 'held_out' : 'interactive'),
      dispatch: async () => {
        const lines = (await readFile(path.join(f.root, 'extension-events.jsonl'), 'utf8')).trim().split('\n');
        assert.equal(JSON.parse(lines.at(-1)!).kind, 'reserved'); // Durable reservation precedes provider dispatch.
        calls++; return { value: 'synthetic result', usageMicro: 1 };
      } });
    for (const phase of ['held_out', 'interactive'] as const) await assert.rejects(withExtensionReservation({ ...f, request: request(phase), dispatch: async () => { calls++; return { value: '', usageMicro: 1 }; } }), /allowance exhausted/);
    assert.equal(calls, 18);
    assert.equal(await readFile(path.join(f.root, 'ledger.json'), 'utf8'), f.baseline);
    const events = (await readFile(path.join(f.root, 'extension-events.jsonl'), 'utf8')).trim().split('\n').map(s => JSON.parse(s));
    assert.equal(4_054_254 + events.filter(e => e.kind === 'reserved').reduce((n, e) => n + e.reservedMicro, 0), 4_954_254);
  } finally { await rm(f.root, { recursive: true }); }
});

test('concurrent dispatch and duplicate request cannot spend twice', async () => {
  const f = await fixture(), r = request(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const first = withExtensionReservation({ ...f, request: r, dispatch: async () => { entered(); await gate; return { value: 1, usageMicro: 20 }; } });
    await started;
    await assert.rejects(withExtensionReservation({ ...f, request: request(), dispatch: async () => { throw Error('Must not dispatch'); } }), /EEXIST/);
    release(); await first;
    await assert.rejects(withExtensionReservation({ ...f, request: r, dispatch: async () => { throw Error('Must not dispatch'); } }), /already reserved/);
  } finally { release?.(); await rm(f.root, { recursive: true }); }
});

test('lost response retains reservation, sanitizes failure, and blocks a fresh request after reopen', async () => {
  const f = await fixture(); let calls = 0;
  try {
    await assert.rejects(withExtensionReservation({ ...f, request: request(), dispatch: async () => { calls++; throw Error('PRIVATE_SENTINEL'); } }), /reservation retained/);
    await assert.rejects(withExtensionReservation({ ...f, request: request(), dispatch: async () => { calls++; return { value: '', usageMicro: 0 }; } }), /requires review/);
    assert.equal(calls, 1);
    const journal = await readFile(path.join(f.root, 'extension-events.jsonl'), 'utf8');
    assert.ok(!journal.includes('PRIVATE_SENTINEL')); assert.match(journal, /"reservedMicro":50000/);
  } finally { await rm(f.root, { recursive: true }); }
});

test('changed baseline and truncated journal both prevent dispatch', async () => {
  const f = await fixture(); let calls = 0;
  const dispatch = async () => { calls++; return { value: 1, usageMicro: 0 }; };
  try {
    await writeFile(path.join(f.root, 'ledger.json'), f.baseline + ' ');
    await assert.rejects(withExtensionReservation({ ...f, request: request(), dispatch }), /Baseline identity changed/);
    await writeFile(path.join(f.root, 'ledger.json'), f.baseline);
    await writeFile(path.join(f.root, 'extension-events.jsonl'), '{"partial":');
    await assert.rejects(withExtensionReservation({ ...f, request: request(), dispatch }), /Partial journal/);
    assert.equal(calls, 0);
  } finally { await rm(f.root, { recursive: true }); }
});

test('invalid or excessive usage remains a failed reserved attempt', async () => {
  for (const usageMicro of [NaN, -1, 50_001]) {
    const f = await fixture();
    try {
      await assert.rejects(withExtensionReservation({ ...f, request: request(), dispatch: async () => ({ value: '', usageMicro }) }), /reservation retained/);
      const lines = (await readFile(path.join(f.root, 'extension-events.jsonl'), 'utf8')).trim().split('\n');
      assert.equal(JSON.parse(lines[0]).kind, 'reserved'); assert.equal(JSON.parse(lines[1]).kind, 'failed');
    } finally { await rm(f.root, { recursive: true }); }
  }
});
