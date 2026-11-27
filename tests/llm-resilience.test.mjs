import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, chatStreamWithFallback, resetBreakers, probeProvider, probeAllProviders } from '../lib/llm.mjs';
import { runScout } from '../lib/scout.mjs';

test('circuit breaker opens, half-opens, and closes', () => {
  let t = 0;
  const b = new CircuitBreaker({
    now: () => t,
    failureThreshold: 0.5,
    minimumRequests: 4,
    windowMs: 1000,
    cooldownMs: 500,
    halfOpenSuccesses: 2,
  });

  for (let i = 0; i < 4; i++) {
    assert.ok(b.canRequest());
    b.onFailure();
  }
  assert.equal(b.current(), 'open');
  assert.equal(b.canRequest(), false);

  t = 600;
  assert.equal(b.current(), 'half_open');
  assert.equal(b.canRequest(), true);
  assert.equal(b.canRequest(), false, 'only one probe at a time');

  b.onSuccess();
  b.onSuccess();
  assert.equal(b.current(), 'closed');
});

test('fallback uses the next provider when one is unknown', async () => {
  resetBreakers();
  const chunks = [];
  for await (const chunk of chatStreamWithFallback({
    providers: ['does-not-exist', 'mock'],
    system: 'hello',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    if (chunk.delta) chunks.push(chunk.delta);
  }
  assert.ok(chunks.join('').length > 0);
});

test('fallback rejects when every provider fails', async () => {
  resetBreakers();
  await assert.rejects(async () => {
    for await (const _ of chatStreamWithFallback({
      providers: ['nope', 'also-nope'],
      system: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      /* consume nothing */
    }
  }, /all providers failed/);
});


test('probeProvider cancels the unread response body', async () => {
  const original = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => ({ ok: true, status: 200, body: { cancel: async () => { cancelled = true; } } });
  try {
    const result = await probeProvider('openai', 1000);
    assert.equal(result.ok, true);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});

test('probeAllProviders caches briefly and force refreshes', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, body: { cancel: async () => {} } };
  };
  try {
    await probeAllProviders({ force: true });
    const afterFirst = calls;
    assert.ok(afterFirst > 0);
    await probeAllProviders();
    assert.equal(calls, afterFirst, 'cached probe should not hit the network again');
    await probeAllProviders({ force: true });
    assert.ok(calls > afterFirst, 'force should bypass the cache');
  } finally {
    globalThis.fetch = original;
  }
});


test('scout propagates AbortError instead of returning a fallback report', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => runScout({ message: 'find something', provider: 'mock', signal: ac.signal }),
    (err) => err.name === 'AbortError',
  );
});
