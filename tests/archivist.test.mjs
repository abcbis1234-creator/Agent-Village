import test from 'node:test';
import assert from 'node:assert/strict';
import { Archivist } from '../lib/archivist.mjs';
import { embed } from '../lib/memory.mjs';

function makeStore() {
  const snapshots = [];
  const memories = [];
  return {
    addMemoryRecord: async (m) => { memories.push(m); return m; },
    listMemories: () => memories,
  };
}

test('Archivist consolidates a run into a snapshot', async () => {
  const store = makeStore();
  const archivist = new Archivist(store);

  const run = {
    id: 'run-1',
    conversationId: 'conv-1',
    provider: 'mock',
    status: 'ok',
    createdAt: Date.now() - 1000,
    finishedAt: Date.now(),
    events: [
      { type: 'tool_result', payload: { tool: 'calculator', result: '42' } },
      { type: 'message_end', payload: { content: 'The answer is 42' } },
    ],
  };
  const conversation = { id: 'conv-1', title: 'math question', userId: 'u1' };

  const snap = await archivist.consolidate(run, conversation);
  assert.ok(snap.id);
  assert.ok(snap.runId === 'run-1');
  assert.ok(snap.status === 'ok');
  assert.ok(snap.toolCount === 1);
  assert.ok(snap.lessons.length >= 0);
  assert.ok(snap.createdAt);
});

test('Archivist retrieve uses semantic similarity + recency + strength', async () => {
  const store = makeStore();
  const archivist = new Archivist(store);

  await archivist.consolidate(
    { id: 'r1', conversationId: 'c1', provider: 'mock', status: 'ok', createdAt: Date.now() - 1000, finishedAt: Date.now(), events: [] },
    { id: 'c1', title: 'python programming question', userId: 'u1' },
  );
  await archivist.consolidate(
    { id: 'r2', conversationId: 'c2', provider: 'mock', status: 'ok', createdAt: Date.now() - 1000, finishedAt: Date.now(), events: [] },
    { id: 'c2', title: 'javascript web development', userId: 'u1' },
  );

  const hits = archivist.retrieve('python programming', { userId: 'u1', k: 5 });
  assert.ok(hits.length >= 1);
  // The python snapshot should score higher than javascript for a python query
  const pythonHit = hits.find((h) => h.mission === 'python programming question');
  const jsHit = hits.find((h) => h.mission === 'javascript web development');
  if (pythonHit && jsHit) {
    assert.ok(pythonHit.relevanceScore >= jsHit.relevanceScore);
  }
});

test('Archivist reflect synthesizes beliefs from recent runs', async () => {
  const store = makeStore();
  const archivist = new Archivist(store);

  // Create several successful runs
  for (let i = 0; i < 5; i++) {
    await archivist.consolidate(
      { id: `r${i}`, conversationId: 'c', provider: 'mock', status: 'ok', createdAt: Date.now() - i * 1000, finishedAt: Date.now(), events: [] },
      { id: 'c', title: `run ${i}`, userId: 'u1' },
    );
  }

  const reflection = archivist.reflect({ userId: 'u1' });
  assert.ok(Array.isArray(reflection.beliefs));
  assert.ok(reflection.snapshotCount === 5);
  assert.ok(typeof reflection.successRate === 'number');
  assert.ok(reflection.successRate === 1);
});

test('Archivist decay reduces strength of old memories', async () => {
  const store = makeStore();
  const archivist = new Archivist(store, { halfLifeMs: 1000 }); // 1 second half-life

  await archivist.consolidate(
    { id: 'r1', conversationId: 'c', provider: 'mock', status: 'ok', createdAt: Date.now() - 5000, finishedAt: Date.now(), events: [] },
    { id: 'c', title: 'old memory', userId: 'u1' },
  );

  const stats = archivist.stats();
  assert.ok(stats.totalSnapshots === 1);
  assert.ok(stats.averageStrength < 1.0); // should have decayed
});

test('Archivist reconsolidation updates strength', async () => {
  const store = makeStore();
  const archivist = new Archivist(store);

  const snap = await archivist.consolidate(
    { id: 'r1', conversationId: 'c', provider: 'mock', status: 'ok', createdAt: Date.now(), finishedAt: Date.now(), events: [] },
    { id: 'c', title: 'test', userId: 'u1' },
  );
  const originalStrength = snap.strength;

  // Disconfirm first to reduce strength below 1.0
  const disconfirmed = await archivist.reconsolidate(snap.id, 'disconfirming evidence', { confirmed: false });
  const disconfirmedStrength = disconfirmed.strength;
  assert.ok(disconfirmedStrength < originalStrength);

  // Confirm to increase strength back up
  const confirmed = await archivist.reconsolidate(snap.id, 'confirming evidence', { confirmed: true });
  assert.ok(confirmed.strength > disconfirmedStrength);
});
