import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../server.mjs';
import { Store } from '../lib/store.mjs';
import { orchestrate } from '../lib/orchestrator.mjs';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'av-suspend-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  return store;
}

async function start() {
  const store = await freshStore();
  const { server } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, store, base: `http://127.0.0.1:${port}` };
}

test('orchestrate pauses at a phase boundary when the run is suspended', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  run.status = 'suspended';
  const events = [];
  for await (const evt of orchestrate({ message: 'hello', provider: 'mock', user: 'anon', store, conversationId: 'c1', runId: run.id })) events.push(evt);
  assert.ok(events.some((e) => e.type === 'suspended'), 'suspended event missing');
  assert.ok(!events.some((e) => e.type === 'done'), 'suspended run must not finish');
});

test('archive_written event is emitted with lessons (deriveLessons is defined)', async () => {
  const store = await freshStore();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const events = [];
  for await (const evt of orchestrate({ message: 'say hi', provider: 'mock', user: 'anon', store, conversationId: 'c1', runId: run.id })) events.push(evt);
  const archive = events.find((e) => e.type === 'archive_written');
  assert.ok(archive, 'archive_written event missing');
  assert.ok(Array.isArray(archive.lessons));
  assert.ok(events.some((e) => e.type === 'done'));
});

test('store lists checkpoints scoped to a run', async () => {
  const store = await freshStore();
  await store.saveCheckpoint('r1', 'recall', { ok: true });
  await store.saveCheckpoint('r2', 'recall', { ok: true });
  const cps = store.listCheckpoints('r1');
  assert.equal(cps.length, 1);
  assert.equal(cps[0].data.ok, true);
  assert.equal(store.listCheckpoints('r3').length, 0);
});

test('handled 4xx responses do not trigger a second write', async () => {
  const { server, store, base } = await start();
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.map(String).join(' '));
  try {
    const run = store.createRun({ conversationId: 'c1', provider: 'mock', user: 'u1' });
    const forbidden = await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST', headers: { 'X-Village-User': 'u2' } });
    assert.equal(forbidden.status, 403);
    const missing = await fetch(`${base}/api/runs/nope/suspend`, { method: 'POST' });
    assert.equal(missing.status, 404);
    const suspended = await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST', headers: { 'X-Village-User': 'u1' } });
    assert.equal(suspended.status, 200);
    const conflict = await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST', headers: { 'X-Village-User': 'u1' } });
    assert.equal(conflict.status, 409);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.error = original;
    await new Promise((resolve) => server.close(resolve));
  }
  assert.deepEqual(logged, [], `unexpected server errors: ${logged.join('\n')}`);
});

test('POST /api/runs/:id/suspend and GET /api/runs/:id/checkpoints', async () => {
  const { server, store, base } = await start();
  try {
    const run = store.createRun({ conversationId: 'c1', provider: 'mock', user: 'u1' });
    const s = await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST', headers: { 'X-Village-User': 'u1' } });
    assert.equal(s.status, 200);
    assert.equal((await s.json()).run.status, 'suspended');
    assert.equal(store.getRun(run.id).status, 'suspended');
    assert.equal((await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST', headers: { 'X-Village-User': 'u1' } })).status, 409);
    assert.equal((await fetch(`${base}/api/runs/${run.id}/suspend`, { method: 'POST', headers: { 'X-Village-User': 'u2' } })).status, 403);
    assert.equal((await fetch(`${base}/api/runs/nope/suspend`, { method: 'POST' })).status, 404);
    const cp = await fetch(`${base}/api/runs/${run.id}/checkpoints`, { headers: { 'X-Village-User': 'u1' } });
    assert.equal(cp.status, 200);
    assert.ok(Array.isArray((await cp.json()).checkpoints));
  } finally { server.close(); }
});
