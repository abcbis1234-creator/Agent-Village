import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { Store } from '../lib/store.mjs';
import { verifyExport } from '../lib/signature.mjs';

async function start() {
  const dir = await mkdtemp(join(tmpdir(), 'av-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  const { server, ctx } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, store, ctx, base: `http://127.0.0.1:${port}` };
}

test('index serves with hardened headers', async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    const html = await res.text();
    assert.match(html, /id="timeline-list"/);
    assert.match(html, /id="budget-fill"/);
  } finally { server.close(); }
});
test('health endpoint', async () => {
  const { server, base } = await start();
  try { const res = await fetch(`${base}/api/health`); assert.deepEqual(await res.json(), { ok: true }); } finally { server.close(); }
});

test('healthz liveness and readyz readiness', async () => {
  const { server, base } = await start();
  try {
    const hz = await fetch(`${base}/api/healthz`);
    assert.equal(hz.status, 200);
    assert.equal((await hz.json()).status, 'ok');
    const rz = await fetch(`${base}/api/readyz`);
    assert.equal(rz.status, 200);
    const body = await rz.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.checks.store, 'ok');
  } finally { server.close(); }
});

test('error responses use RFC 9457 problem details', async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const body = await r.json();
    assert.equal(body.type, 'about:blank');
    assert.equal(body.title, 'Not Found');
    assert.equal(body.status, 404);
    assert.equal(body.detail, 'not found');
    assert.equal(body.instance, '/api/nope');
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.error, 'not found');
    // Method not allowed on a known path.
    const r2 = await fetch(`${base}/api/health`, { method: 'POST' });
    assert.ok(r2.status === 404 || r2.status === 405);
    if (r2.status === 404) assert.equal((await r2.json()).code, 'NOT_FOUND');
  } finally { server.close(); }
});

test('validation errors use problem details and keep the legacy error field', async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/knowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' }),
    });
    assert.equal(r.status, 422);
    assert.equal(r.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const body = await r.json();
    assert.equal(body.status, 422);
    assert.equal(body.title, 'Unprocessable Content');
    assert.equal(body.error, 'text required');
    assert.equal(body.instance, '/api/knowledge');
  } finally { server.close(); }
});

test('idempotency key dedupes want creation', async () => {
  const { server, base } = await start();
  try {
    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'want-123' };
    const r1 = await fetch(`${base}/api/wants`, { method: 'POST', headers, body: JSON.stringify({ text: 'find a coffee shop' }) });
    const w1 = await r1.json();
    assert.ok(w1.id);
    const r2 = await fetch(`${base}/api/wants`, { method: 'POST', headers, body: JSON.stringify({ text: 'find a coffee shop' }) });
    const w2 = await r2.json();
    assert.equal(w2.id, w1.id, 'duplicate returns the original want');
    // Only one want was actually created.
    const list = await (await fetch(`${base}/api/wants`)).json();
    assert.equal(list.wants.length, 1);
  } finally { server.close(); }
});

test('chat SSE includes schema version and monotonic event ids', async () => {
  const { server, base } = await start();
  try {
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    const res = await fetch(`${base}/api/conversations/${c.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }) });
    assert.equal(res.headers.get('x-sse-schema'), '1');
    const text = await res.text();
    assert.match(text, /id: 1\nevent: run_id/);
    assert.match(text, /"schemaVersion":1/);
    assert.match(text, /id: 2\nevent:/);
  } finally { server.close(); }
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

test('resume continues a completed run from checkpoints', async () => {
  const { server, base, store } = await start();
  try {
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    // First run to completion; this persists phase checkpoints.
    const res = await fetch(`${base}/api/conversations/${c.id}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }) });
    const firstText = await res.text();
    const runId = firstText.match(/event: run_id\ndata: {"runId":"([^"]+)"/)[1];
    assert.match(firstText, /event: done/);

    // Resume the (now complete) run.
    const res2 = await fetch(`${base}/api/runs/${runId}/resume`, { method: 'POST' });
    assert.equal(res2.status, 200);
    const resumeText = await res2.text();
    assert.match(resumeText, /event: phase_resumed/);
    assert.match(resumeText, /event: done/);
    // All phases were served from checkpoints (no fresh tool execution).
    const resumedPhases = (resumeText.match(/event: phase_resumed/g) ?? []).length;
    assert.ok(resumedPhases >= 4, `expected >=4 resumed phases, got ${resumedPhases}`);
  } finally { server.close(); }
});

test('resume rejects unknown and in-progress runs', async () => {
  const { server, base } = await start();
  try {
    const r1 = await fetch(`${base}/api/runs/does-not-exist/resume`, { method: 'POST' });
    assert.equal(r1.status, 404);
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


test('run reads and cancellation are scoped to the owning user', async () => {
  const { server, base } = await start();
  try {
    const alice = { 'Content-Type': 'application/json', 'x-village-user': 'alice' };
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: alice, body: '{}' })).json();
    const text = await (await fetch(`${base}/api/conversations/${c.id}/chat`, {
      method: 'POST', headers: alice, body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }),
    })).text();
    const runId = text.match(/event: run_id\ndata: {"runId":"([^"]+)"/)[1];

    const bob = { 'x-village-user': 'bob' };
    for (const [path, init] of [
      [`/api/runs/${runId}/events`, { headers: bob }],
      [`/api/runs/${runId}/export`, { headers: bob }],
      [`/api/runs/${runId}/cancel`, { method: 'POST', headers: bob }],
    ]) {
      const r = await fetch(`${base}${path}`, init);
      assert.equal(r.status, 403, `${path} must not leak another user's run`);
    }
    const own = await fetch(`${base}/api/runs/${runId}/events`, { headers: alice });
    assert.equal(own.status, 200);
    assert.ok((await own.json()).events.length > 0);
  } finally { server.close(); }
});

test('SSE replay with Last-Event-ID resumes above the cursor in order', async () => {
  const { server, base } = await start();
  try {
    const headers = { 'Content-Type': 'application/json', 'x-village-user': 'alice' };
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers, body: '{}' })).json();
    const first = await (await fetch(`${base}/api/conversations/${c.id}/chat`, {
      method: 'POST', headers, body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }),
    })).text();
    const runId = first.match(/event: run_id\ndata: {"runId":"([^"]+)"/)[1];
    const before = await (await fetch(`${base}/api/runs/${runId}/events`, { headers })).json();
    assert.ok(before.events.length >= 3);

    const resumed = await (await fetch(`${base}/api/runs/${runId}/resume`, {
      method: 'POST', headers: { ...headers, 'Last-Event-ID': '2' },
    })).text();
    const ids = [...resumed.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    assert.ok(ids.length > 0, 'replay should emit persisted events');
    assert.ok(ids.every((id) => id > 2), `replayed ids must exceed the cursor: ${ids.join(',')}`);
    assert.ok(ids.every((id, i) => i === 0 || id > ids[i - 1]), `ids must increase: ${ids.join(',')}`);
    // The live connection marker follows the replay and carries no id.
    assert.match(resumed, /event: run_id\ndata: {"runId":"[^"]+","schemaVersion":1,"resumedFrom":2}/);
  } finally { server.close(); }
});

test('JSON bodies must be objects and structured +json media types are accepted', async () => {
  const { server, base } = await start();
  try {
    const nullBody = await fetch(`${base}/api/wants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
    });
    assert.equal(nullBody.status, 400);

    const arrayBody = await fetch(`${base}/api/wants`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]',
    });
    assert.equal(arrayBody.status, 400);

    const suffix = await fetch(`${base}/api/wants`, {
      method: 'POST', headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ text: 'fix the bridge' }),
    });
    assert.equal(suffix.status, 201);

    const jsonp = await fetch(`${base}/api/wants`, {
      method: 'POST', headers: { 'Content-Type': 'application/jsonp' }, body: '{}',
    });
    assert.equal(jsonp.status, 415);
  } finally { server.close(); }
});

test('export refuses to sign without a configured secret, then verifies with one', async () => {
  const previous = process.env.VILLAGE_EXPORT_SECRET;
  delete process.env.VILLAGE_EXPORT_SECRET;
  const { server, base } = await start();
  try {
    const headers = { 'Content-Type': 'application/json' };
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers, body: '{}' })).json();
    const text = await (await fetch(`${base}/api/conversations/${c.id}/chat`, {
      method: 'POST', headers, body: JSON.stringify({ message: 'what is 2+2?', provider: 'mock' }),
    })).text();
    const runId = text.match(/event: run_id\ndata: {"runId":"([^"]+)"/)[1];

    const unconfigured = await fetch(`${base}/api/runs/${runId}/export`);
    assert.equal(unconfigured.status, 503);

    process.env.VILLAGE_EXPORT_SECRET = 'test-export-secret';
    const ok = await fetch(`${base}/api/runs/${runId}/export`);
    assert.equal(ok.status, 200);
    const signed = await ok.json();
    assert.equal(signed.alg, 'HS256');
    assert.equal(verifyExport(signed), true);
    assert.equal(verifyExport({ body: signed.body, sig: '00' }), false);
  } finally {
    server.close();
    if (previous === undefined) delete process.env.VILLAGE_EXPORT_SECRET;
    else process.env.VILLAGE_EXPORT_SECRET = previous;
  }
});


test('owner cancellation aborts the tracked run', async () => {
  const { server, store, ctx, base } = await start();
  try {
    const headers = { 'Content-Type': 'application/json', 'x-village-user': 'alice' };
    const c = await (await fetch(`${base}/api/conversations`, { method: 'POST', headers, body: '{}' })).json();
    const run = store.createRun({ conversationId: c.id, provider: 'mock', user: 'alice' });
    const ac = new AbortController();
    ctx.aborts.set(run.id, ac);
    const res = await fetch(`${base}/api/runs/${run.id}/cancel`, { method: 'POST', headers: { 'x-village-user': 'alice' } });
    assert.equal(res.status, 200);
    assert.equal(ac.signal.aborted, true);
    ctx.aborts.delete(run.id); // the stream's finally block does this on abort
    // A finished/untracked run cannot be cancelled again.
    const again = await fetch(`${base}/api/runs/${run.id}/cancel`, { method: 'POST', headers: { 'x-village-user': 'alice' } });
    assert.equal(again.status, 409);
  } finally { server.close(); }
});

test('world stream does not drop events that share a timestamp', async () => {
  const { server, store, base } = await start();
  try {
    const ts = Date.now();
    store.data.world.push({ id: 'w1', type: 'world_event', ts, description: 'first event' });
    store.data.world.push({ id: 'w2', type: 'world_event', ts, description: 'second event' });
    const ac = new AbortController();
    const res = await fetch(`${base}/api/world/stream`, { signal: ac.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (!(buf.includes('first event') && buf.includes('second event'))) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    assert.match(buf, /first event/);
    assert.match(buf, /second event/);
    ac.abort();
  } finally { server.close(); }
});

test('director formats endpoint advertises presets and exports', async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/api/director/formats`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.formats.some((format) => format.id === 'srt' && format.extension === 'srt'));
    assert.ok(body.formats.some((format) => format.id === 'otio'));
    assert.ok(body.platforms.some((platform) => platform.id === 'tiktok' && platform.aspect === '9:16'));
    assert.ok(body.aspects.includes('9:16'));
    assert.ok(body.tones.includes('premium'));
    assert.deepEqual(body.fps, [24, 25, 30, 60]);
  } finally { server.close(); }
});

test('director plan endpoint is deterministic and returns usable exports', async () => {
  const { server, base } = await start();
  try {
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brief: 'A 30 second premium promo for my coffee shop', durationSeconds: 30, scenes: 6, seed: 'server-test' }),
    };
    const first = await (await fetch(`${base}/api/director/plan`, request)).json();
    const second = await (await fetch(`${base}/api/director/plan`, request)).json();
    assert.deepEqual(first.plan, second.plan);
    assert.equal(first.plan.durationMs, 30_000);
    assert.equal(first.plan.scenes.length, 6);
    assert.match(first.exports.srt, /00:00:00,000 --> /);
    assert.match(first.exports.fcpxml, /<fcpxml version="1.9">/);
    assert.equal(JSON.parse(first.exports.otio).OTIO_SCHEMA, 'Timeline.1');
  } finally { server.close(); }
});

test('director export endpoint returns a download descriptor', async () => {
  const { server, base } = await start();
  try {
    const planRes = await fetch(`${base}/api/director/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'srt', plan: { brief: 'A product teaser', scenes: [{ role: 'hook', durationMs: 2000 }, { role: 'cta', durationMs: 3000 }] } }),
    });
    assert.equal(planRes.status, 200);
    const data = await planRes.json();
    assert.equal(data.format, 'srt');
    assert.equal(data.contentType, 'application/x-subrip; charset=utf-8');
    assert.match(data.filename, /\.srt$/);
    assert.match(data.body, /-->/);
  } finally { server.close(); }
});

test('director rejects invalid plans with problem details', async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/api/director/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief: '' }),
    });
    assert.equal(res.status, 422);
    assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    const body = await res.json();
    assert.match(body.detail, /brief/);
  } finally { server.close(); }
});

test('director page is served with the same hardened headers', async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/director.html`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(await res.text(), /id="scene-grid"/);
  } finally { server.close(); }
});
