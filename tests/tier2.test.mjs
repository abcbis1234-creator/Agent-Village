import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Archivist } from '../lib/memory-v2.mjs';
import { Critic } from '../lib/critic-v2.mjs';
import { SecurityReviewer, VERDICTS } from '../lib/security-v2.mjs';
import { Store } from '../lib/store.mjs';
import { orchestrate } from '../lib/orchestrator.mjs';
import { chatStream } from '../lib/llm.mjs';

/* ---------- fakes ---------- */

function fakeStore() {
  const mems = [];
  return {
    data: { memories: mems },
    addMemoryRecord: async (m) => { mems.push(m); return m; },
    listMemories: () => mems,
    save: async () => {},
    queueReflection: async () => {},
    appendEvent: () => ({}),
    listEvents: () => [],
  };
}

function mockLLM(response) {
  return {
    async* chatStream() {
      yield { delta: response, done: false };
      yield { delta: '', done: true };
    },
  };
}

function hermeticCritic(store) {
  // Pin the Critic to mock so a developer's real API keys never leak into tests.
  return new Critic({ llm: { chatStream }, store, availableProviders: ['mock'] });
}

/* ---------- Archivist v2 ---------- */

test('archivist rejects near-duplicate memories', async () => {
  const a = new Archivist(fakeStore());
  const m1 = await a.record({ text: 'the sky is blue', importance: 3 });
  const m2 = await a.record({ text: 'the sky is blue', importance: 3 });
  assert.equal(m1.id, m2.id);
});

test('archivist retrieval blends relevance, recency, importance', async () => {
  const a = new Archivist(fakeStore());
  await a.record({ text: 'the sky is blue', importance: 5 });
  await a.record({ text: 'dogs bark loudly', importance: 1 });
  const hits = a.retrieve('what color is the sky', { k: 5 });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].memory.text, /sky/);
  assert.ok(hits[0].score > 0);
});

test('archivist reflection pressure triggers at threshold', async () => {
  const store = fakeStore();
  let queued = 0;
  store.queueReflection = async () => { queued++; };
  const a = new Archivist(store, { reflectionThreshold: 5 });
  await a.record({ text: 'alpha note', importance: 2 });
  await a.record({ text: 'beta note', importance: 2 });
  await a.record({ text: 'gamma note', importance: 2 }); // 6 >= 5 -> triggers
  assert.equal(queued, 1);
});

test('archivist dream cycle promotes and decays', async () => {
  const store = fakeStore();
  const a = new Archivist(store);
  const m = await a.record({ text: 'important recurring fact', importance: 4 });
  m.accessCount = 4;
  const before = store.listMemories().length;
  const result = await a.dreamCycle();
  assert.ok(result.promoted >= 1);
  assert.ok(store.listMemories().length > before);
});

test('archivist refuses to store secrets', async () => {
  const a = new Archivist(fakeStore());
  await assert.rejects(
    () => a.record({ text: 'my api_key: sk-abcdefghijklmnopqrst' }),
    /secret/i,
  );
});

test('archivist correct supersedes instead of overwriting', async () => {
  const store = fakeStore();
  const a = new Archivist(store);
  const m = await a.record({ text: 'the vault is under the oak tree', importance: 3 });
  const corrected = await a.correct(m.id, { correction: 'the vault moved to the library' });
  assert.ok(corrected.id !== m.id);
  assert.ok(store.listMemories().find((x) => x.id === m.id).supersededBy);
});

/* ---------- Critic v2 ---------- */

test('critic never accepts builder self-assessment (type-level)', async () => {
  const c = new Critic({ llm: mockLLM('{}'), store: fakeStore() });
  const sig = c.review.toString();
  assert.ok(!sig.includes('builderSelfAssessment'));
});

test('critic rejects when any lens finds a fatal flaw', async () => {
  const llm = {
    async* chatStream({ system }) {
      if (system.includes('Falsification')) {
        yield { delta: '{"fatal":true,"finding":"math is wrong","evidence":"2+2=5","confidence":0.9}', done: false };
      } else {
        yield { delta: '{"satisfies":true,"gaps":[],"confidence":0.5}', done: false };
      }
      yield { delta: '', done: true };
    },
  };
  const c = new Critic({ llm, store: fakeStore() });
  const v = await c.review({ artifact: '2+2=5', request: 'what is 2+2?', builderProvider: 'openai' });
  assert.equal(v.overall, 'reject');
  assert.ok(v.findings.some((f) => f.fatal));
  assert.ok(Array.isArray(v.issues));
});

test('critic accepts when all lenses pass', async () => {
  const llm = {
    async* chatStream({ system }) {
      if (system.includes('Falsification')) {
        yield { delta: '{"fatal":false,"finding":"none found","confidence":0.8}', done: false };
      } else if (system.includes('Caller Verification')) {
        yield { delta: '{"satisfies":true,"gaps":[],"confidence":0.7}', done: false };
      } else {
        yield { delta: '{"counterCase":"none","counterSucceeds":false,"confidence":0.6}', done: false };
      }
      yield { delta: '', done: true };
    },
  };
  const c = new Critic({ llm, store: fakeStore() });
  const v = await c.review({ artifact: '42', request: 'what is 6*7?', builderProvider: 'openai' });
  assert.equal(v.overall, 'accept');
  assert.equal(v.providerIndependent, true);
  assert.equal(v.criticProvider, 'anthropic');
});

test('critic chooses a provider different from the builder', () => {
  const c = new Critic({ llm: mockLLM('{}'), store: fakeStore() });
  assert.notEqual(c._chooseIndependentProvider('openai'), 'openai');
  assert.notEqual(c._chooseIndependentProvider('anthropic'), 'anthropic');
});

/* ---------- Security Reviewer v2 ---------- */

test('security L1 denies unknown tools without touching the LLM', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const d = await s.gate({ tool: 'rm_rf', args: {} });
  assert.equal(d.verdict, VERDICTS.DENY);
  assert.equal(d.layer, 'L1');
});

test('security L1 denies path traversal in dangerous args', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const d = await s.gate({ tool: 'sd_generate', args: { prompt: '../../etc/passwd' } });
  assert.equal(d.verdict, VERDICTS.DENY);
});

test('security L1 rejects unexpected args (strict schema)', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const d = await s.gate({ tool: 'calculator', args: { expression: '1+1', evil: 'x' } });
  assert.equal(d.verdict, VERDICTS.DENY);
  assert.ok(d.reasons.some((r) => r.includes('unexpected arg')));
});

test('security guarded tool requires a capability token', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const d = await s.gate({ tool: 'sd_generate', args: { prompt: 'a cat' } });
  assert.equal(d.verdict, VERDICTS.REQUIRE_APPROVAL);
});

test('security capability token is single-use and scoped', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const tok = s.mintCapability({ tool: 'sd_generate', scope: 'once', ttlMs: 5000 });
  const d1 = await s.gate({ tool: 'sd_generate', args: { prompt: 'a cat' }, capabilityToken: tok });
  assert.notEqual(d1.verdict, VERDICTS.REQUIRE_APPROVAL);
  const d2 = await s.gate({ tool: 'sd_generate', args: { prompt: 'a cat' }, capabilityToken: tok });
  assert.equal(d2.verdict, VERDICTS.REQUIRE_APPROVAL); // reused -> rejected
});

test('security decision is signed', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const d = await s.gate({ tool: 'calculator', args: { expression: '1+1' } });
  assert.ok(d.signature && d.signature.length === 32);
});

test('security scopes hard-deny to dangerous args (prose is allowed)', async () => {
  const s = new SecurityReviewer({ llm: null, store: fakeStore() });
  const ok = await s.gate({ tool: 'remember', args: { text: 'the meeting is at 3; bring notes' } });
  assert.equal(ok.verdict, VERDICTS.ALLOW);
  const denied = await s.gate({ tool: 'remember', args: { text: 'my api_key: sk-abcdefghijklmnopqrst' } });
  assert.equal(denied.verdict, VERDICTS.DENY);
});

/* ---------- Orchestrator integration ---------- */

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'av-tier2-'));
  const s = new Store(join(dir, 's.json'));
  await s.load();
  return s;
}

async function collect(opts) {
  const events = [];
  for await (const e of orchestrate({ ...opts, provider: opts.provider ?? 'mock' })) events.push(e);
  return events;
}

test('orchestrator emits memory_packet before plan', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 2+2?', store, user: 'u', conversationId: 'c', runId: 'r', critic: hermeticCritic(store) });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('memory_packet'));
  assert.ok(types.indexOf('memory_packet') < types.indexOf('planner_raw'));
});

test('orchestrator emits security_decision for tool calls', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 6*7?', store, user: 'u', conversationId: 'c', runId: 'r', critic: hermeticCritic(store) });
  const decisions = events.filter((e) => e.type === 'security_decision');
  assert.ok(decisions.length >= 1);
  assert.equal(decisions[0].decision.verdict, VERDICTS.ALLOW);
  assert.ok(decisions[0].decision.signature.length === 32);
});

test('orchestrator critic_result has v2 shape with issues alias', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 2+2?', store, user: 'u', conversationId: 'c', runId: 'r', critic: hermeticCritic(store) });
  const critic = events.filter((e) => e.type === 'critic_result');
  assert.ok(critic.length >= 1);
  assert.ok('overall' in critic[0]);
  assert.ok(Array.isArray(critic[0].issues));
  assert.ok(Array.isArray(critic[0].findings));
  assert.equal(typeof critic[0].confidence, 'number');
});