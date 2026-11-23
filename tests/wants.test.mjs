import test from 'node:test';
import assert from 'node:assert/strict';
import { WantBoard } from '../lib/wants.mjs';

function fakeStore() {
  return { data: { wants: [], world: [], runs: {}, memories: [] }, save: async () => {} };
}

test('posts and lists open wants', () => {
  const s = fakeStore();
  const b = new WantBoard(s);
  const w = b.post({ text: 'find me a plumber', author: 'alice' });
  assert.equal(w.status, 'open');
  assert.equal(b.list().length, 1);
  assert.equal(b.list()[0].id, w.id);
});

test('claim then fulfill transitions the status', () => {
  const s = fakeStore();
  const b = new WantBoard(s);
  const w = b.post({ text: 'fix my roof' });
  b.claim(w.id, { by: 'builder' });
  assert.equal(w.status, 'claimed');
  b.fulfill(w.id, { by: 'builder', result: 'fixed' });
  assert.equal(w.status, 'fulfilled');
  assert.equal(w.result, 'fixed');
});

test('cannot fulfill an unclaimed want', () => {
  const s = fakeStore();
  const b = new WantBoard(s);
  const w = b.post({ text: 'water my plants' });
  assert.throws(() => b.fulfill(w.id, { by: 'builder' }), /claimed/);
});

test('only the owner can cancel', () => {
  const s = fakeStore();
  const b = new WantBoard(s);
  const w = b.post({ text: 'walk my dog', user: 'alice' });
  assert.throws(() => b.cancel(w.id, { user: 'bob' }), /not your/);
  b.cancel(w.id, { user: 'alice' });
  assert.equal(w.status, 'cancelled');
});

test('rejects empty wants', () => {
  const b = new WantBoard(fakeStore());
  assert.throws(() => b.post({ text: '   ' }), /required/);
});