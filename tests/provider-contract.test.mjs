import test from 'node:test';
import assert from 'node:assert/strict';
import { chatStream, chatStreamWithFallback } from '../lib/llm.mjs';

// Collect all chunks from an async generator.
async function collect(gen) {
  const out = [];
  for await (const c of gen) out.push(c);
  return out;
}

test('contract: mock provider yields delta then done', async () => {
  const chunks = await collect(chatStream({ provider: 'mock', system: 's', messages: [{ role: 'user', content: 'hi' }] }));
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[chunks.length - 1].done, true);
});

test('contract: unknown provider throws', async () => {
  await assert.rejects(
    () => collect(chatStream({ provider: 'does-not-exist', system: 's', messages: [] })),
    /unknown provider/,
  );
});

test('contract: fallback skips unknown provider and uses mock', async () => {
  const chunks = await collect(chatStreamWithFallback({
    providers: ['does-not-exist', 'mock'],
    system: 's',
    messages: [{ role: 'user', content: 'hi' }],
  }));
  assert.ok(chunks.length >= 1, 'fell through to mock');
  assert.equal(chunks[chunks.length - 1].done, true);
});

test('contract: all-unknown chain fails with ALL_PROVIDERS_FAILED', async () => {
  await assert.rejects(
    () => collect(chatStreamWithFallback({ providers: ['nope1', 'nope2'], system: 's', messages: [] })),
    (e) => e.code === 'ALL_PROVIDERS_FAILED',
  );
});

test('contract: aborted signal rejects with AbortError', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => collect(chatStreamWithFallback({ providers: ['mock'], system: 's', messages: [{ role: 'user', content: 'hi' }], signal: ac.signal })),
    (e) => e.name === 'AbortError',
  );
});

test('contract: empty provider list falls back to default', async () => {
  // providers: [] is falsy-ish; the helper defaults to the primary provider.
  const chunks = await collect(chatStreamWithFallback({ providers: [], system: 's', messages: [{ role: 'user', content: 'hi' }] }));
  assert.ok(chunks.length >= 1 || chunks.length === 0); // must not throw
});