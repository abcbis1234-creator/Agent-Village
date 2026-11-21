import test from 'node:test';
import assert from 'node:assert/strict';
import { Archivist } from '../lib/archivist.mjs';

function fakeStore() {
  const mems = [];
  return { addMemoryRecord: async (m) => { mems.push(m); return m; }, listMemories: () => mems.filter((m) => !m.supersededBy), save: async () => {} };
}

test('rejects near-duplicates', async () => {
  const a = new Archivist(fakeStore());
  const m1 = await a.record({ text: 'the sky is blue', importance: 3 });
  const m2 = await a.record({ text: 'the sky is blue', importance: 3 });
  assert.equal(m1.id, m2.id);
});
test('retrieval blends factors', async () => {
  const store = fakeStore(); const a = new Archivist(store);
  await a.record({ text: 'the sky is blue', importance: 5 });
  await a.record({ text: 'dogs bark loudly', importance: 1 });
  const hits = a.retrieve('color of sky', { k: 5 });
  assert.ok(hits.length >= 1);
  assert.match(hits[0].memory.text, /sky/);
});
test('consolidation promotes', async () => {
  const store = fakeStore(); const a = new Archivist(store);
  const m = await a.record({ text: 'recurring fact', importance: 4 });
  m.accessCount = 4;
  const r = await a.consolidate();
  assert.ok(r.promoted >= 1);
});