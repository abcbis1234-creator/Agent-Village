import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPlan } from '../lib/orchestrator.mjs';
import { SecurityReviewer } from '../lib/security.mjs';

const security = new SecurityReviewer({});

test('verifyPlan accepts valid steps', () => {
  const steps = [
    { tool: 'calculator', args: { expression: '2+2' } },
    { tool: 'clock', args: {} },
  ];
  const r = verifyPlan(steps, security);
  assert.equal(r.accepted.length, 2);
  assert.equal(r.rejected.length, 0);
});

test('verifyPlan rejects unknown tools', () => {
  const r = verifyPlan([{ tool: 'frobnicate', args: {} }], security);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /unknown tool/);
});

test('verifyPlan rejects missing required args and wrong types', () => {
  const r = verifyPlan([
    { tool: 'calculator', args: {} }, // missing expression
    { tool: 'calculator', args: { expression: 42 } }, // wrong type
    { tool: 'clock', args: { bogus: 1 } }, // unexpected arg
  ], security);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected.length, 3);
  assert.match(r.rejected[0].reason, /missing required arg/);
  assert.match(r.rejected[1].reason, /must be string/);
  assert.match(r.rejected[2].reason, /unexpected arg/);
});

test('verifyPlan accepts optional args omitted', () => {
  const r = verifyPlan([{ tool: 'recall', args: { query: 'x' } }], security); // k is optional
  assert.equal(r.accepted.length, 1);
});