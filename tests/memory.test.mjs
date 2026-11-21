import test from 'node:test';
import assert from 'node:assert/strict';
import { embed, cosine, VectorMemory } from '../lib/memory.mjs';

test('embedding is normalized and deterministic', () => {
  const a = embed('the sky is blue');
  const b = embed('the sky is blue');
  assert.deepEqual([...a], [...b]);
  let norm = 0;
  for (const x of a) norm += x * x;
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-4);
});

test('semantic similarity ranks related above unrelated', () => {
  const q = embed('what color is the sky');
  const sky = embed('the sky is blue during the day');
  const dog = embed('my dog barks loudly');
  assert.ok(cosine(q, sky) > cosine(q, dog));
});

test('VectorMemory stores and retrieves per-user', async () => {
  const records = [];
  const store = {
    addMemoryRecord: async (m) => { records.push(m); return m; },
    listMemories: () => records,
  };
  const vm = new VectorMemory(store);
  await vm.add('the sky is blue', [], 'u1');
  await vm.add('dogs are loyal', [], 'u1');
  await vm.add('secret other user', [], 'u2');
  const hits = vm.search('color of sky', { user: 'u1' });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].mem.text, /sky/);
  assert.ok(hits.every((h) => h.mem.user === 'u1'));
});
