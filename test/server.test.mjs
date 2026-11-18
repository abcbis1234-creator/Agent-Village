import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server, generateImageStableDiffusion, providerConfig, llmConfig, runRateState, feedbackStore, knowledgeStore, saveFeedback, saveKnowledge } from '../server.mjs';

let port;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  runRateState.clear();
});

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        if (data) { try { parsed = JSON.parse(data); } catch {} }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

test('Agent Village API, static serving, and security guards', async () => {
  const health = await request('/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.ok, true);
  assert.ok(Number.isInteger(health.body.capabilities) && health.body.capabilities > 0);

  const caps = await request('/api/capabilities');
  assert.strictEqual(caps.status, 200);
  assert.ok(Array.isArray(caps.body.capabilities));
  assert.ok(caps.body.capabilities.some((c) => c.key === 'code'));

  const contract = await request('/api/agent-contract');
  assert.strictEqual(contract.status, 200);
  assert.strictEqual(contract.body.version, '1.0');
  assert.ok(contract.body.endpoints);

  const run = await request('/api/run', 'POST', { mission: 'Create a webnovel about a builder', capability: 'auto', rounds: 1 });
  assert.strictEqual(run.status, 200);
  assert.ok(run.body.id);
  assert.strictEqual(run.body.mission, 'Create a webnovel about a builder');
  assert.ok(run.body.deliverable && run.body.deliverable.sections);
  assert.ok(Array.isArray(run.body.reports) && run.body.reports.length > 0);
  assert.ok(run.body.verdict && run.body.verdict.decision && run.body.verdict.rationale);

  const run2 = await request('/api/run', 'POST', { mission: 'Plan a launch', rounds: 5 });
  assert.strictEqual(run2.status, 200);
  assert.strictEqual(run2.body.rounds, 3);

  const bad = await request('/api/run', 'POST', { mission: '' });
  assert.strictEqual(bad.status, 400);

  const bad2 = await request('/api/run', 'POST', {});
  assert.strictEqual(bad2.status, 400);

  const long = await request('/api/run', 'POST', { mission: 'x'.repeat(1201) });
  assert.strictEqual(long.status, 400);

  const index = await request('/');
  assert.strictEqual(index.status, 200);
  assert.ok(typeof index.body === 'string' && index.body.includes('AGENT VILLAGE'));

  const traversal = await request('/../../etc/passwd');
  assert.ok(traversal.status === 403 || traversal.status === 404, `traversal should be blocked, got ${traversal.status}`);

  const missing = await request('/api/nope');
  assert.strictEqual(missing.status, 404);
});

test('Path traversal variants are rejected', async () => {
  const variants = [
    '/../../etc/passwd',
    '/../server.mjs',
    '/./../package.json',
    '/public/../server.mjs',
    '/%2e%2e/%2e%2e/server.mjs',
    '/..%2f..%2fserver.mjs',
  ];
  for (const path of variants) {
    const res = await request(path);
    assert.ok(res.status === 403 || res.status === 404, `${path} should be 403/404, got ${res.status}`);
  }

  const index = await request('/');
  assert.strictEqual(index.status, 200);

  const css = await request('/styles.css');
  assert.strictEqual(css.status, 200);

  const js = await request('/app.js');
  assert.strictEqual(js.status, 200);
});

test('Rate limiting on /api/run', async () => {
  const pending = [];
  for (let i = 0; i < 35; i += 1) {
    pending.push(request('/api/run', 'POST', { mission: `rate test ${i}`, capability: 'auto', rounds: 1 }));
  }
  const results = await Promise.all(pending);
  const limited = results.filter((r) => r.status === 429);
  assert.ok(limited.length > 0, 'expected at least one 429 rate-limited response');
  const ok = results.filter((r) => r.status === 200);
  assert.ok(ok.length > 0, 'expected at least one successful response before limit');
  const limitedBody = limited[0].body;
  assert.ok(limitedBody.error && limitedBody.retry_after, 'rate limit response should include error and retry_after');
});

test('New top-model capabilities route and verdict metadata', async () => {
  const cases = [
    { mission: 'reason through this logic puzzle step by step', expected: 'reasoning' },
    { mission: 'combine image and text into a multimodal brief', expected: 'multimodal' },
    { mission: 'plan an agentic task with tool boundaries', expected: 'agentic' },
    { mission: 'synthesize this long document into a summary', expected: 'long_context' },
    { mission: 'handle this cross-domain open-ended task', expected: 'generalist' },
  ];
  for (const { mission, expected } of cases) {
    const res = await request('/api/run', 'POST', { mission, capability: 'auto', rounds: 1 });
    assert.strictEqual(res.status, 200, `${mission} should return 200`);
    assert.strictEqual(res.body.capability.key, expected, `${mission} should route to ${expected}, got ${res.body.capability.key}`);
    assert.ok(res.body.deliverable && res.body.deliverable.sections, `${mission} should have a deliverable`);
    assert.ok(res.body.verdict && res.body.verdict.decision, `${mission} should have a verdict decision`);
    assert.ok(res.body.verdict.confidence, `${mission} should have a confidence level`);
    assert.ok(res.body.verdict.calibrated === true, `${mission} should be calibrated`);
  }

  const generalist = await request('/api/run', 'POST', { mission: 'write a business plan and analyze the market', capability: 'generalist', rounds: 2 });
  assert.strictEqual(generalist.status, 200);
  assert.strictEqual(generalist.body.capability.key, 'generalist');
  assert.strictEqual(generalist.body.rounds, 2);
  assert.ok(generalist.body.deliverable.sections.some((s) => s.name === 'Objective'));

  const capabilitiesRes = await request('/api/capabilities');
  for (const key of ['generalist', 'reasoning', 'multimodal', 'agentic', 'long_context']) {
    assert.ok(capabilitiesRes.body.capabilities.some((c) => c.key === key), `capabilities should include ${key}`);
  }
});

test('Provider health and media generation guards', async () => {
  const prov = await request('/api/providers');
  assert.strictEqual(prov.status, 200);
  assert.ok(Array.isArray(prov.body.providers));
  const kinds = prov.body.providers.map((p) => p.kind);
  assert.ok(kinds.includes('image') && kinds.includes('video'));

  const original = { configured: providerConfig.image.configured, baseUrl: providerConfig.image.baseUrl };

  // Unconfigured provider fails fast with 400.
  providerConfig.image.configured = false;
  providerConfig.image.baseUrl = '';
  try {
    const unconfigured = await request('/api/media/generate', 'POST', { kind: 'image', prompt: 'a roblox scene' });
    assert.strictEqual(unconfigured.status, 400);
    assert.match(String(unconfigured.body.error), /not configured/);
  } finally {
    providerConfig.image.configured = original.configured;
    providerConfig.image.baseUrl = original.baseUrl;
  }

  // Temporarily mark configured to exercise the approval gate (unreachable SD endpoint).
  providerConfig.image.configured = true;
  providerConfig.image.baseUrl = 'http://127.0.0.1:9';
  try {
    const pending = await request('/api/media/generate', 'POST', { kind: 'image', prompt: 'a roblox scene' });
    assert.strictEqual(pending.status, 202);
    assert.ok(pending.body.id);
    assert.strictEqual(pending.body.error, 'approval required');

    const approve = await request('/api/media/approve', 'POST', { id: pending.body.id });
    assert.strictEqual(approve.status, 200);
    assert.strictEqual(approve.body.approved, true);

    const gen = await request('/api/media/generate', 'POST', { kind: 'image', prompt: 'a roblox scene', approved: true, id: pending.body.id });
    assert.strictEqual(gen.status, 400); // unreachable SD endpoint -> adapter error

    const missing = await request('/api/media/generate', 'POST', { kind: 'image' });
    assert.strictEqual(missing.status, 400);
  } finally {
    providerConfig.image.configured = original.configured;
    providerConfig.image.baseUrl = original.baseUrl;
  }

  const badApprove = await request('/api/media/approve', 'POST', { id: 'does-not-exist' });
  assert.strictEqual(badApprove.status, 400);
});

test('Stable Diffusion adapter respects configuration', async () => {
  const cfg = providerConfig.image;
  assert.strictEqual(cfg.provider, 'stable-diffusion');
  if (!cfg.configured) {
    await assert.rejects(() => generateImageStableDiffusion('a roblox scene'), /not configured/);
  } else {
    assert.ok(cfg.baseUrl, 'configured SD provider must have a base URL');
  }
});

test('Feedback corrections drive routing; knowledge injects into deliverables', async () => {
  const mission = 'compose a haiku about the midnight sea';
  const cleanupFeedback = () => {
    for (let i = feedbackStore.length - 1; i >= 0; i -= 1) {
      if (String(feedbackStore[i].mission).toLowerCase().includes('midnight sea')) feedbackStore.splice(i, 1);
    }
  };
  cleanupFeedback();

  const fb = await request('/api/feedback', 'POST', { mission, expectedCapability: 'creative', note: 'haiku is creative work' });
  assert.strictEqual(fb.status, 200);
  assert.ok(fb.body.learned && fb.body.learned.id);

  const after = await request('/api/run', 'POST', { mission, capability: 'auto', rounds: 1 });
  assert.strictEqual(after.status, 200);
  assert.strictEqual(after.body.capability.key, 'creative');

  const bad = await request('/api/feedback', 'POST', { mission: 'some other mission', expectedCapability: 'auto' });
  assert.strictEqual(bad.status, 400);

  const kn = await request('/api/knowledge', 'POST', { title: 'Village brand voice', content: 'Always use a warm playful tone for the village brand.' });
  assert.strictEqual(kn.status, 200);
  assert.ok(kn.body.entry && kn.body.entry.id);

  const run = await request('/api/run', 'POST', { mission: 'write a village brand description', capability: 'writing', rounds: 1 });
  assert.strictEqual(run.status, 200);
  assert.ok(run.body.deliverable.sections.some((s) => s.name === 'Knowledge'), 'deliverable should include matched knowledge');
  assert.ok(Array.isArray(run.body.knowledge) && run.body.knowledge.length > 0);

  const list = await request('/api/knowledge');
  assert.ok(Array.isArray(list.body.knowledge));
  assert.ok(list.body.knowledge.some((k) => k.title === 'Village brand voice'));

  // Cleanup persistent test data so runs stay repeatable.
  cleanupFeedback();
  for (let i = knowledgeStore.length - 1; i >= 0; i -= 1) {
    if (knowledgeStore[i].title === 'Village brand voice') knowledgeStore.splice(i, 1);
  }
  await saveFeedback();
  await saveKnowledge();
});

test('LLM provider generates via an OpenAI-compatible endpoint', async () => {
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      assert.strictEqual(parsed.model, 'mock-model');
      const content = JSON.stringify({
        decision: 'LLM decision for the mission',
        rationale: 'LLM rationale grounded in knowledge',
        dissent: 'LLM dissent and watch-outs',
        next_actions: ['Review the LLM deliverable', 'Run the smallest slice'],
        confidence: 'high',
        deliverable: { title: 'LLM deliverable', sections: [{ name: 'Section A', content: 'Content A' }] },
        reports: [1, 2, 3, 4, 5].map((i) => ({ role: `r${i}`, text: `Report ${i} from LLM` })),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  const original = { configured: llmConfig.configured, baseUrl: llmConfig.baseUrl, model: llmConfig.model };
  llmConfig.configured = true;
  llmConfig.baseUrl = `http://127.0.0.1:${mockPort}`;
  llmConfig.model = 'mock-model';
  try {
    const res = await request('/api/run', 'POST', { mission: 'write a launch plan for a robot cafe', capability: 'planning', rounds: 1 });
    assert.strictEqual(res.status, 200);
    assert.match(res.body.source, /LLM/);
    assert.strictEqual(res.body.verdict.decision, 'LLM decision for the mission');
    assert.strictEqual(res.body.verdict.confidence, 'high');
    assert.ok(res.body.deliverable.sections.some((s) => s.name === 'Section A'));
    assert.ok(res.body.reports.length >= 5);
    assert.ok(res.body.reports.every((r) => /LLM/.test(r.source)));
  } finally {
    llmConfig.configured = original.configured;
    llmConfig.baseUrl = original.baseUrl;
    llmConfig.model = original.model;
    await new Promise((resolve) => mock.close(resolve));
  }
});

test('LLM failure falls back to the demo router', async () => {
  const original = { configured: llmConfig.configured, baseUrl: llmConfig.baseUrl };
  llmConfig.configured = true;
  llmConfig.baseUrl = 'http://127.0.0.1:9';
  try {
    const res = await request('/api/run', 'POST', { mission: 'write a launch plan', capability: 'planning', rounds: 1 });
    assert.strictEqual(res.status, 200);
    assert.match(res.body.source, /MANAGED LOCAL DEMO/);
    assert.ok(res.body.verdict && res.body.verdict.decision);
  } finally {
    llmConfig.configured = original.configured;
    llmConfig.baseUrl = original.baseUrl;
  }
});
