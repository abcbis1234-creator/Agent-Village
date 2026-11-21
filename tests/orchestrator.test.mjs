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
