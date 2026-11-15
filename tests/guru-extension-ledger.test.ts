import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withExtensionReservation, amendRepairAllocation, reviewFailedAttempt, type FailedAttemptReview, type ExtensionRequest } from '../scripts/guru-benchmark/extension-ledger';

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


test('explicit append-only amendment reserves two repair probes without resetting the original eight calls', async () => {
 const f=await fixture();let calls=0;
 const run=(phase:ExtensionRequest['phase'])=>withExtensionReservation({...f,request:request(phase),dispatch:async()=>{calls++;return {value:1,usageMicro:1};}});
 try {
  for(let i=0;i<8;i++)await run('held_out');
  await assert.rejects(run('repair_probe'),/allowance exhausted/);
  const before=await readFile(path.join(f.root,'extension-events.jsonl'),'utf8');
  await amendRepairAllocation(f.root,f.baselineHash);
  assert.ok((await readFile(path.join(f.root,'extension-events.jsonl'),'utf8')).startsWith(before));
  await assert.rejects(amendRepairAllocation(f.root,f.baselineHash),/already amended/);
  for(let i=0;i<2;i++)await run('repair_probe');
  for(let i=0;i<8;i++)await run('interactive');
  for(const phase of ['held_out','repair_probe','interactive'] as const)await assert.rejects(run(phase),/allowance exhausted/);
  assert.equal(calls,18);assert.equal(await readFile(path.join(f.root,'ledger.json'),'utf8'),f.baseline);
 }finally{await rm(f.root,{recursive:true});}
});
test('allocation cannot erase nine already consumed interactive reservations', async () => {
 const f=await fixture();
 try{
  for(let i=0;i<9;i++)await withExtensionReservation({...f,request:request('interactive'),dispatch:async()=>({value:1,usageMicro:1})});
  const before=await readFile(path.join(f.root,'extension-events.jsonl'),'utf8');
  await assert.rejects(amendRepairAllocation(f.root,f.baselineHash),/cannot be reduced/);
  assert.equal(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8'),before);
 }finally{await rm(f.root,{recursive:true});}
});

async function failedReview(f: Awaited<ReturnType<typeof fixture>>, r = request('interactive')) {
 await assert.rejects(withExtensionReservation({...f,request:r,dispatch:async()=>{throw Error('SYNTHETIC_PRIVATE_BODY');}}),/reservation retained/);
 const journal=await readFile(path.join(f.root,'extension-events.jsonl'),'utf8');
 const failureLine=journal.trimEnd().split('\n').at(-1)!+'\n';
 const review:FailedAttemptReview={requestId:r.requestId,failedEventSha256:createHash('sha256').update(failureLine).digest('hex'),
  repairedSourceCommit:'d'.repeat(40),repairedSourceSha256:'e'.repeat(64),reviewEvidenceSha256:'f'.repeat(64),
  reason:'validated_response_schema_mismatch_repaired'};
 return {r,review,journal};
}

test('review preserves the failed terminal and spent slot; only seven new repaired-source interactive IDs remain', async()=>{
 const f=await fixture();let calls=0;
 const dispatch=async()=>{calls++;return {value:'synthetic',usageMicro:1};};
 try{
  for(let i=0;i<8;i++)await withExtensionReservation({...f,request:request(),dispatch});
  await amendRepairAllocation(f.root,f.baselineHash);
  for(let i=0;i<2;i++)await withExtensionReservation({...f,request:request('repair_probe'),dispatch});
  const {r,review,journal}=await failedReview(f);
  const result=await reviewFailedAttempt({...f,review});
  assert.deepEqual(result,{totalReservedMicro:4_604_254,remainingInPhase:7,requiredSourceCommit:review.repairedSourceCommit,failedReservationRetained:true});
  const reviewed=await readFile(path.join(f.root,'extension-events.jsonl'),'utf8');
  assert.ok(reviewed.startsWith(journal));assert.ok(!reviewed.includes('SYNTHETIC_PRIVATE_BODY'));
  await assert.rejects(withExtensionReservation({...f,request:{...r,sourceCommit:review.repairedSourceCommit},dispatch}),/already reserved/);
  await assert.rejects(withExtensionReservation({...f,request:request('interactive'),dispatch}),/source differs/);
  await assert.rejects(reviewFailedAttempt({...f,review}),/Invalid failed-attempt review/);
  assert.equal(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8'),reviewed);
  for(let i=0;i<7;i++)await withExtensionReservation({...f,request:{...request('interactive'),sourceCommit:review.repairedSourceCommit},dispatch});
  await assert.rejects(withExtensionReservation({...f,request:{...request('interactive'),sourceCommit:review.repairedSourceCommit},dispatch}),/allowance exhausted/);
  const events=(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8')).trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(events.filter(e=>e.kind==='reserved').length,18);assert.equal(events.filter(e=>e.kind==='failed').length,1);
  assert.equal(events.filter(e=>e.kind==='failed_attempt_reviewed').length,1);assert.equal(calls,17);
  assert.equal(await readFile(path.join(f.root,'ledger.json'),'utf8'),f.baseline);
 }finally{await rm(f.root,{recursive:true});}
});

test('review rejects wrong identity/hash/source, free text and an owned mutex without modifying evidence', async()=>{
 const f=await fixture();
 try{
  const {r,review,journal}=await failedReview(f);
  for(const bad of [{...review,requestId:randomUUID()},{...review,failedEventSha256:'0'.repeat(64)},
   {...review,repairedSourceCommit:r.sourceCommit},{...review,reason:'RAW_PRIVATE_TEXT'},
   {...review,answer:'RAW_PRIVATE_TEXT'},{...review,reviewEvidenceSha256:'not-a-hash'}]){
   await assert.rejects(reviewFailedAttempt({...f,review:bad as FailedAttemptReview}));
   assert.equal(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8'),journal);
  }
  await mkdir(path.join(f.root,'publisher.lock'));
  await assert.rejects(reviewFailedAttempt({...f,review}),/EEXIST/);
  assert.equal(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8'),journal);
 }finally{await rm(f.root,{recursive:true});}
});

test('pending/completed attempts are not reviewable and review cannot implicitly change phase limits', async()=>{
 const f=await fixture();
 try{
  const {review,journal}=await failedReview(f);
  await writeFile(path.join(f.root,'extension-events.jsonl'),journal.split('\n')[0]+'\n');
  await assert.rejects(reviewFailedAttempt({...f,review}),/Invalid failed-attempt review/);
  await assert.rejects(withExtensionReservation({...f,request:request(),dispatch:async()=>({value:0,usageMicro:0})}),/requires review/);
  await writeFile(path.join(f.root,'extension-events.jsonl'),journal);
  await reviewFailedAttempt({...f,review});
  const before=await readFile(path.join(f.root,'extension-events.jsonl'),'utf8');
  await assert.rejects(amendRepairAllocation(f.root,f.baselineHash),/Allocation cannot change/);
  assert.equal(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8'),before);
  const events=journal.trim().split('\n').map(s=>JSON.parse(s));
  events[1]={version:1,baselineHash:f.baselineHash,requestId:review.requestId,at:events[1].at,kind:'completed',usageMicro:1};
  await writeFile(path.join(f.root,'extension-events.jsonl'),events.map(e=>JSON.stringify(e)+'\n').join(''));
  await assert.rejects(reviewFailedAttempt({...f,review}),/Invalid failed-attempt review/);
 }finally{await rm(f.root,{recursive:true});}
});

test('malformed, duplicate, mismatched and late review events fail closed on reopening', async()=>{
 const f=await fixture();let calls=0;
 try{
  const {review,journal}=await failedReview(f);await reviewFailedAttempt({...f,review});
  const good=await readFile(path.join(f.root,'extension-events.jsonl'),'utf8');
  const event=JSON.parse(good.trimEnd().split('\n').at(-1)!);
  const dispatch=async()=>{calls++;return {value:0,usageMicro:0};};
  const next={...request('interactive'),sourceCommit:review.repairedSourceCommit};
  const premature={version:1,baselineHash:f.baselineHash,at:event.at,requestId:next.requestId,kind:'reserved',request:next,reservedMicro:50000};
  for(const broken of [good+JSON.stringify(event)+'\n',good.slice(0,-1),
   journal+JSON.stringify({...event,failedEventSha256:'0'.repeat(64)})+'\n',
   journal+JSON.stringify({...event,reviewEvidenceSha256:'malformed'})+'\n',
   journal+JSON.stringify(premature)+'\n'+JSON.stringify(event)+'\n']){
   await writeFile(path.join(f.root,'extension-events.jsonl'),broken);
   await assert.rejects(withExtensionReservation({...f,request:next,dispatch}));
   assert.equal(await readFile(path.join(f.root,'extension-events.jsonl'),'utf8'),broken);
  }
  assert.equal(calls,0);
 }finally{await rm(f.root,{recursive:true});}
});
