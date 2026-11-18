import test from 'node:test';
import assert from 'node:assert/strict';
import { listModelProviders, generateWithModel, compareModels } from '../studio/model-gateway.mjs';

const env = {
  OPENAI_API_KEY: 'test-openai',
  ANTHROPIC_API_KEY: 'test-anthropic',
  GEMINI_API_KEY: 'test-gemini',
  OPENAI_MODEL: 'test-openai-model',
  ANTHROPIC_MODEL: 'test-claude-model',
  GEMINI_MODEL: 'test-gemini-model'
};

test('provider status reveals configuration but never credentials', () => {
  const providers = listModelProviders(env);
  assert.equal(providers.length, 4);
  assert.ok(providers.some((item) => item.id === 'ollama' && item.configured));
  assert.ok(providers.every((item) => item.configured));
  assert.ok(providers.every((item) => !Object.hasOwn(item, 'key')));
});

test('OpenAI Responses API request is normalized', async () => {
  let captured;
  const result = await generateWithModel({
    provider: 'openai', prompt: 'Review this plan', env,
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ output_text: 'Looks sound.' }), { status: 200 });
    }
  });
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-openai');
  assert.equal(result.text, 'Looks sound.');
});

test('Anthropic and Gemini response shapes are supported', async () => {
  const anthropic = await generateWithModel({ provider: 'anthropic', prompt: 'x', env, fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Claude response' }] })) });
  const gemini = await generateWithModel({ provider: 'gemini', prompt: 'x', env, fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }] })) });
  assert.equal(anthropic.text, 'Claude response');
  assert.equal(gemini.text, 'Gemini response');
});

test('missing keys and oversized prompts are rejected before network calls', async () => {
  await assert.rejects(generateWithModel({ provider: 'openai', prompt: 'x', env: {}, fetchImpl: () => { throw new Error('must not run'); } }), /not configured/);
  await assert.rejects(generateWithModel({ provider: 'openai', prompt: 'x'.repeat(12001), env }), /exceeds/);
});

test('comparison reports individual provider failures without hiding successful results', async () => {
  const result = await compareModels({ prompt: 'Compare', providers: ['openai', 'gemini'], env, fetchImpl: async (url) => url.includes('openai') ? new Response(JSON.stringify({ output_text: 'A' })) : new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 }) });
  assert.equal(result.successful, 1);
  assert.equal(result.results[0].text, 'A');
  assert.equal(result.results[1].ok, false);
});

test('Ollama local chat endpoint works without an API key', async () => {
  let captured;
  const result = await generateWithModel({ provider: 'ollama', prompt: 'Say hello', env: {}, fetchImpl: async (url, options) => {
    captured = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ message: { content: 'Hello from local model.' } }), { status: 200 });
  }});
  assert.equal(captured.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(captured.body.model, 'llama3.2');
  assert.equal(result.text, 'Hello from local model.');
});

test('hosted providers have no guessed default model IDs', () => {
  const providers = listModelProviders({ OPENAI_API_KEY: 'key', ANTHROPIC_API_KEY: 'key', GEMINI_API_KEY: 'key' });
  for (const id of ['openai', 'anthropic', 'gemini']) {
    assert.equal(providers.find((item) => item.id === id).model, '');
  }
});

test('Ollama rejects non-local endpoints before making a request', async () => {
  await assert.rejects(generateWithModel({
    provider: 'ollama', prompt: 'x', env: { OLLAMA_HOST: 'http://192.168.1.20:11434/api/chat' },
    fetchImpl: () => { throw new Error('network must not run'); }
  }), /localhost/);
});

test('invalid timeout is rejected before making a request', async () => {
  await assert.rejects(generateWithModel({ provider: 'ollama', prompt: 'x', env: {}, timeoutMs: 999, fetchImpl: () => { throw new Error('network must not run'); } }), /timeoutMs/);
});

test('Ollama timeout aborts the request', async () => {
  await assert.rejects(generateWithModel({
    provider: 'ollama', prompt: 'x', env: {}, timeoutMs: 1000,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }), /timed out/);
});
