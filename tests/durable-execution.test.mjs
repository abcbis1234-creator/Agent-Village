import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Workflow } from '../lib/workflow.mjs';
import { Store } from '../lib/store.mjs';
import { createApp } from '../server.mjs';

test('workflow completes and emits checkpoints per node', async () => {
  const events = [];
  const w = new Workflow({
    name: 'chain',
    nodes: [
      { id: 'a', run: async () => 'A' },
      { id: 'b', run: async () => 'B' },
    ],
    edges: [{ from: 'a', to: 'b' }],
    onEvent: (e) => events.push(e),
  });
  const out = await w.run();
  assert.deepEqual(out, { a: 'A', b: 'B' });
  const checkpoints = events.filter((e) => e.type === 'checkpoint');
  assert.ok(checkpoints.length >= 3); // after a, after b, and a final one
  assert.deepEqual(w.state().completed, ['a', 'b']);
  assert.equal(w.state().suspended, null);
});

test('suspend pauses at unfinished nodes; resume finishes them', async () => {
  const ran = [];
  let w;
  w = new Workflow({
    name: 'pause',
    nodes: [
      { id: 'a', run: async () => { ran.push('a'); w.suspend('paused-by-user'); return 'A'; } },
      { id: 'b', run: async () => { ran.push('b'); return 'B'; } },
    ],
    edges: [{ from: 'a', to: 'b' }],
  });
  const out = await w.run();
  assert.equal(w.state().suspended, 'paused-by-user');
  assert.deepEqual(ran, ['a']);
  assert.equal(out.a, 'A');
  assert.equal(w.state().completed.includes('b'), false);
  w.resume();
  assert.equal(w.state().suspended, null);
  const out2 = await w.run();
  assert.deepEqual(ran, ['a', 'b']);
  assert.equal(out2.b, 'B');
  assert.deepEqual(w.state().completed, ['a', 'b']);
});

test('run() restores from a checkpoint (crash recovery)', async () => {
  const ran = [];
  const nodes = [
    { id: 'a', run: async () => { ran.push('a'); return 'A'; } },
    { id: 'b', run: async () => { ran.push('b'); return 'B'; } },
  ];
  const edges = [{ from: 'a', to: 'b' }];
  const w1 = new Workflow({ name: 't', nodes, edges });
  await w1.run();
  assert.deepEqual(ran, ['a', 'b']);
  const st = w1.state();
  const w2 = new Workflow({ name: 't', nodes, edges });
  const out = await w2.run({ checkpoint: st });
  assert.deepEqual(ran, ['a', 'b']); // nothing re-runs
  assert.deepEqual(out, { a: 'A', b: 'B' });
  assert.deepEqual(w2.state().completed, ['a', 'b']);
});

test('run() with a suspended checkpoint pauses immediately', async () => {
  const ran = [];
  const w = new Workflow({ name: 't', nodes: [{ id: 'a', run: async () => { ran.push('a'); return 'A'; } }] });
  const out = await w.run({ checkpoint: { completed: [], results: {}, suspended: 'early' } });
  assert.deepEqual(ran, []);
  assert.equal(w.state().suspended, 'early');
  assert.deepEqual(out, {});
});

test('store persists and restores workflow state and checkpoints', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'av-durable-'));
  const path = join(dir, 'state.json');
  const store = new Store(path);
  await store.saveWorkflowState('run-1', { completed: ['a'], results: { a: 1 }, suspended: null });
  await store.saveCheckpoint('run-1', 'a', { value: 42 });
  await store.saveCheckpoint('run-2', 'b', { value: 7 });

  const st = store.getWorkflowState('run-1');
  assert.deepEqual(st.completed, ['a']);
  assert.equal(st.results.a, 1);

  const store2 = new Store(path);
  await store2.load();
  const st2 = store2.getWorkflowState('run-1');
  assert.deepEqual(st2.completed, ['a']);
  assert.equal(st2.results.a, 1);

  const cps = store2.listCheckpoints('run-1');
  assert.equal(cps.length, 1);
  assert.equal(cps[0].data.value, 42);
  assert.equal(store2.getCheckpoint('run-1', 'a').data.value, 42);
  assert.equal(store2.getCheckpoint('run-1', 'nope'), null);
});

async function start() {
  const dir = await mkdtemp(join(tmpdir(), 'av-durable-http-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  const { server } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, store, base: `http://127.0.0.1:${port}` };
}

test('POST /api/runs/:id/suspend and /resume update run status; GET checkpoints lists them', async () => {
  const { server, store, base } = await start();
  try {
    const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
    assert.equal((await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST' })).status, 200);
    assert.equal(store.getRun(run.id).status, 'suspended');
    const r2 = await fetch(`${base}/api/runs/${run.id}/resume`, { method: 'POST' });
    assert.equal(r2.status, 200);
    assert.equal((await r2.json()).resumed, true);
    assert.equal(store.getRun(run.id).status, 'running');
    assert.equal((await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST' })).status, 200);
    assert.equal((await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST' })).status, 409); // already suspended
    assert.equal((await fetch(`${base}/api/runs/nope/suspend`, { method: 'POST' })).status, 404);
    const r6 = await fetch(`${base}/api/runs/${run.id}/checkpoints`);
    assert.equal(r6.status, 200);
    assert.ok(Array.isArray((await r6.json()).checkpoints));
  } finally { server.close(); }
});
