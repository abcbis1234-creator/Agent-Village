import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, isRetryable } from '../lib/retry.mjs';

test('isRetryable classifies transient vs permanent errors', () => {
  assert.equal(isRetryable(Object.assign(new Error('rate'), { status: 429 })), true);
  assert.equal(isRetryable(Object.assign(new Error('boom'), { status: 503 })), true);
  assert.equal(isRetryable(Object.assign(new Error('bad'), { status: 400 })), false);
  assert.equal(isRetryable(Object.assign(new Error('cancelled'), { name: 'AbortError' })), false);
  assert.equal(isRetryable(Object.assign(new Error('open'), { code: 'PROVIDER_UNAVAILABLE' })), false);
});

test('withRetry returns first success without retrying', async () => {
  let calls = 0;
  const result = await withRetry(async () => { calls++; return 'ok'; }, { retries: 3, baseMs: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
});

test('withRetry retries retryable errors then succeeds', async () => {
  let calls = 0;
  const result = await withRetry(async (attempt) => {
    calls++;
    if (attempt < 2) throw Object.assign(new Error('503'), { status: 503 });
    return 'recovered';
  }, { retries: 3, baseMs: 1, maxMs: 2 });
  assert.equal(result, 'recovered');
  assert.equal(calls, 3);
});

test('withRetry throws immediately on non-retryable errors', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw Object.assign(new Error('bad request'), { status: 400 }); }, { retries: 5, baseMs: 1 }),
    /bad request/,
  );
  assert.equal(calls, 1);
});

test('withRetry rethrows AbortError without retrying', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); }, { retries: 5, baseMs: 1 }),
    (e) => e.name === 'AbortError',
  );
  assert.equal(calls, 1);
});

test('withRetry exhausts retries and throws last error', async () => {
  let calls = 0;
  await assert.rejects(
    () => withRetry(async () => { calls++; throw Object.assign(new Error('503'), { status: 503 }); }, { retries: 2, baseMs: 1, maxMs: 2 }),
    /503/,
  );
  assert.equal(calls, 3); // initial + 2 retries
});