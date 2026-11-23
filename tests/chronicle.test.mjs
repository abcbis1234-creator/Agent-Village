import test from 'node:test';
import assert from 'node:assert/strict';
import { Chronicle } from '../lib/chronicle.mjs';
import { GodMode } from '../lib/godmode.mjs';

function fakeStore() {
  return { data: { wants: [], world: [], runs: {}, memories: [] }, save: async () => {} };
}

test('builds a markdown chronicle with stats and events', () => {
  const s = fakeStore();
  new GodMode(s).act({ action: 'festival', target: 'town' });
  const md = new Chronicle(s).build();
  assert.match(md, /Agent Village Chronicle/);
  assert.match(md, /Agents:/);
  assert.match(md, /festival begins/i);
});

test('empty chronicle still renders', () => {
  const md = new Chronicle(fakeStore()).build();
  assert.match(md, /Nothing has happened yet/);
});