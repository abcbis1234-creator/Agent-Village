import test from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, chatStreamWithFallback, resetBreakers } from '../lib/llm.mjs';

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
