import test from 'node:test';
import assert from 'node:assert/strict';
import { chatStream, listProviders, defaultProvider, probeProvider } from '../lib/llm.mjs';

test('mock provider streams deterministic tokens', async () => {
  let text = '';
  let tokens = 0;
  for await (const { delta, done, tokens: t } of chatStream({
    provider: 'mock',
    system: 's',
    messages: [{ role: 'user', content: 'hello' }],
  })) {
    if (done) break;
    text += delta;
    tokens = t ?? tokens;
  }
  assert.match(text, /hello/);
  assert.ok(tokens > 0);
});

test('mock provider is default when nothing configured', () => {
  const old = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.VILLAGE_PROVIDER;
  assert.equal(defaultProvider(), 'mock');
  process.env = old;
});

test('listProviders reports configured state', () => {
  const p = listProviders();
  assert.ok('openai' in p);
  assert.ok('ollama' in p);
  assert.ok('anthropic' in p);
  assert.equal(p.mock.configured, true);
});

test('probeProvider handles mock synchronously', async () => {
  const r = await probeProvider('mock');
  assert.equal(r.ok, true);
});

test('probeProvider handles unreachable host gracefully', async () => {
  process.env.OLLAMA_BASE = 'http://127.0.0.1:1';
  const r = await probeProvider('ollama', 500);
  assert.equal(r.ok, false);
  delete process.env.OLLAMA_BASE;
});
