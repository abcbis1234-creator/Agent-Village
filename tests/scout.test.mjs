import test from 'node:test';
import assert from 'node:assert/strict';
import { scoutRun } from '../lib/scout.mjs';

test('scout parses valid JSON output', async () => {
  const result = await scoutRun({
    message: 'Plan a three-day trip to Tokyo',
    provider: 'mock',
    history: [],
    memory: null,
  });
  assert.ok(Array.isArray(result.facts));
  assert.ok(Array.isArray(result.ambiguities));
  assert.ok(typeof result.suggested_scope === 'string');
  assert.ok(Array.isArray(result.relevant_context));
});

test('scout handles invalid JSON gracefully', async () => {
  const result = await scoutRun({
    message: 'hello',
    provider: 'mock',
    history: [],
    memory: null,
  });
  assert.ok(Array.isArray(result.facts));
  assert.ok(Array.isArray(result.ambiguities));
  assert.ok(typeof result.suggested_scope === 'string');
});

test('scout limits fact and ambiguity counts', async () => {
  const result = await scoutRun({
    message: 'Plan a complex multi-city European tour with budget constraints and visa requirements',
    provider: 'mock',
    history: [],
    memory: null,
  });
  assert.ok(result.facts.length <= 6);
  assert.ok(result.ambiguities.length <= 4);
});
