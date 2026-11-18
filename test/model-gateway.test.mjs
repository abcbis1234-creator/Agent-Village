import test from 'node:test';
import assert from 'node:assert/strict';
import { listModelProviders, generateWithModel, compareModels } from '../studio/model-gateway.mjs';

const env = {
  OPENAI_API_KEY: 'test-openai',
  ANTHROPIC_API_KEY: 'test-anthropic',
  GEMINI_API_KEY: 'test-gemini'
};

test('provider status reveals configuration but never credentials', () => {
  const providers = listModelProviders(env);
  assert.equal(providers.length, 3);
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
