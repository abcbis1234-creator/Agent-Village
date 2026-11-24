import test from 'node:test';
import assert from 'node:assert/strict';
import { route, TIERS, estimateCost } from '../lib/routing/free-first.mjs';

test('route picks local tier for simple tasks', () => {
  const r = route({ message: 'what is 2+2?' });
  assert.equal(r.tier, 'local');
  assert.equal(r.cost, 0);
});

test('route picks a higher tier for complex tasks', () => {
  const r = route({ message: 'Design a distributed systems migration plan with tradeoffs, risks, and a phased rollout across 12 services.' });
  assert.ok(['free-api', 'paid'].includes(r.tier), `expected paid/free-api, got ${r.tier}`);
});

test('route honours maxCost budget constraint', () => {
  const r = route({ message: 'complex task '.repeat(20), context: { maxCost: 0 } });
  assert.equal(r.cost, 0);
  assert.equal(r.tier, 'local');
});

test('route honours forceTier override', () => {
  const r = route({ message: 'anything', context: { forceTier: 'paid' } });
  assert.equal(r.tier, 'paid');
});

test('estimateCost returns 0 for local tier', () => {
  assert.equal(estimateCost('local', 1000), 0);
});

test('TIERS are ordered cheapest first', () => {
  assert.equal(TIERS[0].name, 'local');
  assert.ok(TIERS.length >= 2);
});