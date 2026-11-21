import test from 'node:test';
import assert from 'node:assert/strict';
import {
  route, listAvailableModels, getTier, estimateCost, TIERS, COST_PER_1M_TOKENS,
} from '../lib/routing/free-first.mjs';

test('TIERS defines local, free-api, and paid tiers', () => {
  const names = TIERS.map((t) => t.name);
  assert.ok(names.includes('local'));
  assert.ok(names.includes('free-api'));
  assert.ok(names.includes('paid'));
});

test('COST_PER_1M_TOKENS has zero cost for local and free-api', () => {
  assert.strictEqual(COST_PER_1M_TOKENS.local, 0);
  assert.strictEqual(COST_PER_1M_TOKENS['free-api'], 0);
  assert.ok(COST_PER_1M_TOKENS.paid > 0);
});

test('route trivial task to local tier', () => {
  const result = route({ message: 'hello' });
  assert.strictEqual(result.tier, 'local');
  assert.ok(result.score <= 1);
  assert.ok(result.model);
});

test('route math question to free-api tier', () => {
  const result = route({ message: 'what is 12 * 8 + 4?' });
  assert.ok(result.tier === 'free-api' || result.tier === 'local');
  assert.ok(result.model);
});

test('route complex architecture task to paid tier', () => {
  const result = route({ message: 'Design a microservices architecture for a distributed task queue with retry logic and dead letter handling' });
  assert.strictEqual(result.tier, 'paid');
});

test('route respects max cost constraint', () => {
  const result = route({ message: 'Design a complex distributed system', context: { maxCost: 0 } });
  assert.strictEqual(result.tier, 'local');
  assert.strictEqual(result.reason.includes('budget'), true);
});

test('route honors forceTier override', () => {
  const result = route({ message: 'hello', context: { forceTier: 'paid' } });
  assert.strictEqual(result.tier, 'paid');
  assert.strictEqual(result.reason, 'client-requested tier: paid');
});

test('listAvailableModels returns models with tier info', () => {
  const models = listAvailableModels();
  assert.ok(models.length >= 3);
  assert.ok(models.some((m) => m.tier === 'local'));
  assert.ok(models.some((m) => m.tier === 'free-api'));
  assert.ok(models.some((m) => m.tier === 'paid'));
});

test('getTier returns tier info', () => {
  const t = getTier('local');
  assert.ok(t);
  assert.strictEqual(t.name, 'local');
  assert.strictEqual(t.cost, 0);
  assert.strictEqual(getTier('nonexistent'), null);
});

test('estimateCost returns zero for free tiers', () => {
  assert.strictEqual(estimateCost('local', 1000000), 0);
  assert.strictEqual(estimateCost('free-api', 1000000), 0);
  assert.ok(estimateCost('paid', 1000000) > 0);
});

test('route with ambiguous task goes to paid', () => {
  const result = route({ message: 'maybe we could try doing something with the data', context: { ambiguous: true } });
  assert.strictEqual(result.tier, 'paid');
});

test('route with simple task goes to local', () => {
  const result = route({ message: 'hello world', context: { simple: true } });
  assert.strictEqual(result.tier, 'local');
});
