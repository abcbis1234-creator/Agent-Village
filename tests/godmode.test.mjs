import test from 'node:test';
import assert from 'node:assert/strict';
import { GodMode, GOD_ACTIONS } from '../lib/godmode.mjs';

function fakeStore() {
  return { data: { wants: [], world: [], runs: {}, memories: [] }, save: async () => {} };
}

test('acts append world events', () => {
  const s = fakeStore();
  const g = new GodMode(s);
  const e = g.act({ action: 'airdrop', target: 'town', magnitude: 2 });
  assert.equal(e.action, 'airdrop');
  assert.match(e.description, /200 coins/);
  assert.equal(g.list().length, 1);
});

test('rejects unknown actions', () => {
  const g = new GodMode(fakeStore());
  assert.throws(() => g.act({ action: 'nuke' }), /unknown/);
});

test('lists all god actions', () => {
  const g = new GodMode(fakeStore());
  for (const action of GOD_ACTIONS) g.act({ action });
  assert.equal(g.list().length, GOD_ACTIONS.length);
});