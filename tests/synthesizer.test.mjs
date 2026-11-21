import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizerRun } from '../lib/synthesizer.mjs';

test('synthesizer parses valid JSON output', async () => {
  const result = await synthesizerRun({
    message: 'what is 6*7?',
    toolResults: { calculator: '42' },
    verifierResult: { passed: true, checks: [{ name: 'calculator_valid', pass: true, evidence: 'non-empty' }] },
    provider: 'mock',
  });
  assert.ok(typeof result.summary === 'string');
  assert.ok(Array.isArray(result.evidence_table));
  assert.ok(Array.isArray(result.risks));
  assert.ok(Array.isArray(result.recommendations));
});

test('synthesizer falls back gracefully on bad JSON', async () => {
  const result = await synthesizerRun({
    message: 'hello',
    toolResults: {},
    verifierResult: { passed: true, checks: [] },
    provider: 'mock',
  });
  assert.ok(typeof result.summary === 'string');
  assert.ok(Array.isArray(result.evidence_table));
});

test('synthesizer respects evidence table limits', async () => {
  const manyResults = {};
  for (let i = 0; i < 15; i++) {
    manyResults[`tool${i}`] = `result ${i}`;
  }
  const result = await synthesizerRun({
    message: 'test',
    toolResults: manyResults,
    verifierResult: { passed: true, checks: [] },
    provider: 'mock',
  });
  assert.ok(result.evidence_table.length <= 8);
});
