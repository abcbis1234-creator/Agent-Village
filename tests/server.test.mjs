import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { Store } from '../lib/store.mjs';

async function start() {
  const dir = await mkdtemp(join(tmpdir(), 'av-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  const { server } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

test('index serves with hardened headers', async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  } finally { server.close(); }
});
test('health endpoint', async () => {
  const { server, base } = await start();
  try { const res = await fetch(`${base}/api/health`); assert.deepEqual(await res.json(), { ok: true }); } finally { server.close(); }
});
test('path traversal blocked', async () => {
  const { server, base } = await start();
  try {
    for (const p of ['/../package.json', '/..%2fpackage.json', '/%00']) {
      const r = await fetch(`${base}${p}`); assert.ok(r.status === 400 || r.status === 404, `${p} → ${r.status}`);
    }
  } finally { server.close(); }
});
test('create conversation', async () => {
  const { server, base } = await start();
  try {
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert.ok(c.id);
  } finally { server.close(); }
});
test('chat streams full pipeline', async () => {
  const { server, base } = await start();
  try {
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const res = await fetch(`${base}/api/conversations/${c.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }) });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /event: phase/);
    assert.match(text, /event: tool_result/);
    assert.match(text, /event: critique/);
    assert.match(text, /event: done/);
  } finally { server.close(); }
});
test('town: stats, wants, godmode, tick, chronicle', async () => {
  const { server, base } = await start();
  try {
    const stats = await (await fetch(`${base}/api/town/stats`)).json();
    assert.ok(stats.agents > 0);

    const want = await (await fetch(`${base}/api/wants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'find a coffee shop' }),
    })).json();
    assert.ok(want.id);
    assert.equal(want.status, 'open');

    const claimed = await (await fetch(`${base}/api/wants/${want.id}/claim`, { method: 'POST' })).json();
    assert.equal(claimed.status, 'claimed');

    const fulfilled = await (await fetch(`${base}/api/wants/${want.id}/fulfill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result: 'done' }),
    })).json();
    assert.equal(fulfilled.status, 'fulfilled');

    const god = await (await fetch(`${base}/api/godmode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'airdrop' }),
    })).json();
    assert.equal(god.action, 'airdrop');

    const tick = await (await fetch(`${base}/api/town/tick`, { method: 'POST' })).json();
    assert.ok(tick.tick >= 1);

    const chronicle = await (await fetch(`${base}/api/chronicle`)).text();
    assert.match(chronicle, /Agent Village Chronicle/);
  } finally { server.close(); }
});

test('graceful drain: aborts tracked runs, flushes, and rejects new chats with 503', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'av-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  const { server, ctx } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // A tracked run controller should be aborted by beginDrain.
    const ac = new AbortController();
    ctx.aborts.set('run-x', ac);
    assert.equal(ac.signal.aborted, false);

    const drainPromise = ctx.beginDrain();
    assert.equal(ctx.draining, true);
    assert.equal(ac.signal.aborted, true, 'beginDrain aborts tracked runs');
    await drainPromise; // store flush resolves

    // While draining, a new chat POST is rejected with 503 + Retry-After.
    const conv = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const res = await fetch(`${base}/api/conversations/${conv.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi', provider: 'mock' }) });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '5');
  } finally { server.close(); }
});

test('drain flush persists queued writes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'av-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  // Queue several writes without awaiting, then flush.
  const writes = [];
  for (let i = 0; i < 5; i++) { store.data.wants.push({ id: `w${i}` }); writes.push(store.save()); }
  await Promise.all(writes);
  await store.flush();
  const s2 = new Store(join(dir, 'state.json'));
  await s2.load();
  assert.equal(s2.data.wants.length, 5);
});
