import test from 'node:test';
import assert from 'node:assert/strict';

import { VectorMemory, bm25Scores, tokenize } from '../lib/memory.mjs';
import { Archivist } from '../lib/archivist.mjs';

function fakeStore() {
  const memories = [];
  return {
    memories,
    addMemoryRecord: async (m) => { memories.push(m); return m; },
    listMemories: (user = 'anon') => memories.filter((m) => !m.supersededBy && (!user || m.user === user)),
    save: async () => {},
  };
}

test('tokenize keeps exact names and numbers', () => {
  assert.deepEqual(tokenize('Project ZEPHYR-7 ships 2027'), ['project', 'zephyr', '7', 'ships', '2027']);
});

test('bm25 rewards an exact rare term over common words', () => {
  const scores = bm25Scores('zephyr', ['alpha beta gamma', 'Zephyr launch date', 'delta epsilon']);
  assert.equal(scores.length, 3);
  assert.ok(scores[1] > scores[0] && scores[1] > scores[2], `scores: ${scores.join(',')}`);
});

test('vector search ranks an exact rare name above distractors', async () => {
  const store = fakeStore();
  const memory = new VectorMemory(store);
  await memory.add('The launch code name is Zephyr.', [], 'u1');
  for (let i = 0; i < 20; i++) await memory.add(`Unrelated note ${i} about routine village chores.`, [], 'u1');

  const hits = memory.search('Zephyr', { k: 3, user: 'u1' });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].mem.text, /Zephyr/);
  assert.ok(hits[0].lexical > 0, 'lexical score should be exposed');
});

test('archivist retrieval keeps exact-name recall with a larger pool', async () => {
  const store = fakeStore();
  const a = new Archivist(store);
  await a.record({ text: 'The launch code name is Zephyr.', importance: 3, user: 'u1' });
  for (let i = 0; i < 20; i++) {
    await a.record({ text: `Routine village note ${i} about weather and gardens.`, importance: 3, user: 'u1' });
  }
  const hits = a.retrieve('Zephyr', { k: 3, user: 'u1' });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].memory.text, /Zephyr/);
});

test('memory search stays user-scoped', async () => {
  const store = fakeStore();
  const memory = new VectorMemory(store);
  await memory.add('Alice secret project Zephyr', [], 'alice');
  await memory.add('Bob public project', [], 'bob');
  const hits = memory.search('Zephyr', { user: 'bob' });
  assert.equal(hits.length, 0);
});
