import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate } from '../lib/orchestrator.mjs';
import { Store } from '../lib/store.mjs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'av-'));
  const s = new Store(join(dir, 's.json'));
  await s.load();
  return s;
}

async function collect(opts) {
  const events = [];
  for await (const e of orchestrate({ ...opts, provider: opts.provider ?? 'mock' })) events.push(e);
  return events;
}

test('full event sequence with mock provider', async () => {
  const store = await freshStore();
  const c = await store.createConversation({ agentId: 'planner', user: 'u' });
  const run = store.createRun({ conversationId: c.id, provider: 'mock', user: 'u' });
  const events = await collect({ message: 'hello', user: 'u', store, conversationId: c.id, runId: run.id });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('start'));
  assert.ok(types.includes('phase'));
  assert.ok(types.includes('planner_raw'));
  assert.ok(types.includes('message_start'));
  assert.ok(types.includes('chunk'));
  assert.ok(types.includes('message_end'));
  assert.ok(types.includes('budget'));
  assert.ok(types.includes('done'));
});

test('math question triggers calculator tool', async () => {
  const store = await freshStore();
  const events = await collect({
    message: 'what is 12*8+4?',
    store,
    user: 'u',
    conversationId: 'conv-1',
    runId: 'run-1',
  });
  const calls = events.filter((e) => e.type === 'tool_call');
  assert.ok(calls.length >= 1);
  assert.ok(calls.some((c) => c.tool === 'calculator'));
});

test('plain question triggers no tools', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'hello there', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const calls = events.filter((e) => e.type === 'tool_call');
  assert.equal(calls.length, 0);
});

test('scout phase runs before planner', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'Plan a trip to Tokyo', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const types = events.map((e) => e.type);
  const phases = events.filter((e) => e.type === 'phase').map((e) => e.phase);
  assert.ok(phases.includes('scout'));
  assert.ok(phases.includes('plan'));
  const scoutIdx = phases.indexOf('scout');
  const planIdx = phases.indexOf('plan');
  assert.ok(scoutIdx < planIdx);
});

test('verifier phase runs after builder', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 6*7?', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('verify_result'));
  const verifyIdx = types.indexOf('verify_result');
  const toolResultIdx = types.indexOf('tool_result');
  assert.ok(verifyIdx > toolResultIdx);
});

test('synthesizer phase runs after verifier', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what time is it?', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('synthesize_result'));
  const synthIdx = types.indexOf('synthesize_result');
  const verifyIdx = types.indexOf('verify_result');
  assert.ok(synthIdx > verifyIdx);
});

test('critic phase runs after synthesizer', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 2+2?', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('critic_result'));
  const criticIdx = types.indexOf('critic_result');
  const synthIdx = types.indexOf('synthesize_result');
  assert.ok(criticIdx > synthIdx);
});

test('archivist writes memory after reviewer', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'hello', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const types = events.map((e) => e.type);
  assert.ok(types.includes('archive_written'));
  const archiveIdx = types.indexOf('archive_written');
  const reviewIdx = types.indexOf('message_end');
  assert.ok(archiveIdx > reviewIdx);
});

test('scout result contains facts and ambiguities', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'Plan a complex multi-city tour', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const scoutEvents = events.filter((e) => e.type === 'scout_result');
  assert.ok(scoutEvents.length >= 1);
  assert.ok(Array.isArray(scoutEvents[0].facts));
  assert.ok(Array.isArray(scoutEvents[0].ambiguities));
});

test('verify result contains pass/fail checks', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 2+2?', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const verifyEvents = events.filter((e) => e.type === 'verify_result');
  assert.ok(verifyEvents.length >= 1);
  assert.ok('passed' in verifyEvents[0]);
  assert.ok(Array.isArray(verifyEvents[0].checks));
});

test('critic result contains issues and overall assessment', async () => {
  const store = await freshStore();
  const events = await collect({ message: 'what is 2+2?', store, user: 'u', conversationId: 'conv-1', runId: 'run-1' });
  const criticEvents = events.filter((e) => e.type === 'critic_result');
  assert.ok(criticEvents.length >= 1);
  assert.ok('overall' in criticEvents[0]);
  assert.ok(Array.isArray(criticEvents[0].issues));
});
