import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store, recoverInterruptedRuns } from '../lib/store.mjs';
import { orchestrate, PHASE_GATES, checkPhaseGate } from '../lib/orchestrator.mjs';
import { createApp } from '../server.mjs';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'av-heartbeat-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  return store;
}

test('new runs start with a heartbeat and phase', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  assert.equal(run.status, 'running');
  assert.equal(run.phase, 'queued');
  assert.equal(run.heartbeatSeq, 0);
  assert.ok(run.lastHeartbeatAt > 0);
});

test('heartbeat updates phase, progress, and sequence', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const hb = store.heartbeat(run.id, { phase: 'plan', progress: 7 });
  assert.equal(hb.phase, 'plan');
  assert.equal(hb.progress, 7);
  assert.equal(hb.heartbeatSeq, 1);
  assert.equal(store.getRun(run.id).phase, 'plan');
  assert.equal(store.heartbeat('missing', { phase: 'plan' }), null);
});

test('boot recovery marks stale running runs interrupted', async () => {
  const store = await freshStore();
  const stale = store.createRun({ conversationId: 'c1', provider: 'mock' });
  stale.lastHeartbeatAt = Date.now() - 120_000;
  const fresh = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const done = store.createRun({ conversationId: 'c1', provider: 'mock' });
  done.status = 'ok';

  const recovered = await recoverInterruptedRuns(store);
  assert.equal(recovered.length, 1);
  assert.equal(stale.status, 'interrupted');
  assert.equal(stale.phase, 'interrupted');
  assert.match(stale.error, /no heartbeat/);
  assert.equal(fresh.status, 'running');
  assert.equal(done.status, 'ok');
  assert.ok(store.listEvents(stale.id).some((e) => e.type === 'interrupted'));
});

test('boot recovery with zero staleness catches every orphaned run', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const recovered = await recoverInterruptedRuns(store, { staleAfterMs: 0 });
  assert.equal(recovered.length, 1);
  assert.equal(run.status, 'interrupted');
});

test('phase gates expose explicit entry and exit criteria', () => {
  for (const phase of ['recall', 'scout', 'plan', 'execute', 'synthesize', 'critique', 'archive']) {
    assert.ok(PHASE_GATES[phase], `${phase} has gates`);
    assert.ok(PHASE_GATES[phase].entry.length > 0, `${phase} has entry criteria`);
  }
  const bad = checkPhaseGate('plan', 'entry', {});
  assert.equal(bad.ok, false);
  assert.match(bad.reasons.join(' '), /scout report/);
  const good = checkPhaseGate('plan', 'exit', { plan: { steps: [] } });
  assert.equal(good.ok, true);
});

test('orchestrate refuses to advance past a failed phase gate', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const events = [];
  await assert.rejects(async () => {
    for await (const evt of orchestrate({ message: '   ', provider: 'mock', store, conversationId: 'c1', runId: run.id })) events.push(evt);
  }, /phase recall entry gate failed/);
  assert.ok(events.some((e) => e.type === 'phase_gate_failed' && e.phase === 'recall'));
  assert.ok(!events.some((e) => e.type === 'done'));
});

test('orchestrate records heartbeats and checkpoint events', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const events = [];
  for await (const evt of orchestrate({ message: 'what is 2+2?', provider: 'mock', store, conversationId: 'c1', runId: run.id })) events.push(evt);

  const saved = store.getRun(run.id);
  assert.ok(saved.heartbeatSeq > 0);
  assert.equal(saved.phase, 'archive');
  assert.ok(events.some((e) => e.type === 'checkpoint' && e.phase === 'recall'));
  assert.ok(events.some((e) => e.type === 'checkpoint' && e.phase === 'execute'));
  assert.ok(events.some((e) => e.type === 'heartbeat'));
});

test('chat SSE emits a heartbeat event', async () => {
  const store = await freshStore();
  const { server } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const res = await fetch(`${base}/api/conversations/${conv.id}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }),
    });
    const text = await res.text();
    assert.match(text, /event: heartbeat/);
    assert.match(text, /"phase":"queued"/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
