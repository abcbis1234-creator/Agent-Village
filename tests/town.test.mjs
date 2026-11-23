import test from 'node:test';
import assert from 'node:assert/strict';
import { Town } from '../lib/town.mjs';
import { WantBoard } from '../lib/wants.mjs';

function fakeStore() {
  return { data: { wants: [], world: [], runs: {}, memories: [] }, save: async () => {} };
}

test('tick notices open wants and claims strong matches', () => {
  const s = fakeStore();
  const b = new WantBoard(s);
  const t = new Town(s);
  b.post({ text: 'build me a website' });
  const r = t.tick();
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].action, 'notice');
  assert.equal(s.data.wants[0].status, 'claimed'); // "build" -> builder
});

test('tick increments the tick counter', () => {
  const t = new Town(fakeStore());
  assert.equal(t.tick().tick, 1);
  assert.equal(t.tick().tick, 2);
});

test('stats reflect wants and events', () => {
  const s = fakeStore();
  const b = new WantBoard(s);
  const t = new Town(s);
  b.post({ text: 'find a restaurant' });
  t.tick();
  const stats = t.stats();
  assert.ok(stats.agents > 0);
  assert.equal(stats.wants.total, 1);
  assert.equal(stats.worldEvents, 1);
});