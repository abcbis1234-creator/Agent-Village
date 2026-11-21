import test from 'node:test';
import assert from 'node:assert/strict';
import { critique, quickCritique } from '../lib/critic.mjs';

test('critic flags unsupported claims when no tools ran', () => {
  const result = critique({
    mission: 'what is the capital of france?',
    toolResults: {},
    verifyResult: { passed: false },
    synthesizeResult: { summary: 'Paris is the capital of France.' },
    builderPlan: { steps: [] },
  });
  assert.ok(!result.canProceed || result.issueCount > 0);
  assert.ok(result.issues.some((i) => i.category === 'assumption'));
});

test('critic flags overconfident language without verification', () => {
  const result = critique({
    mission: 'what time is it?',
    toolResults: {},
    verifyResult: { passed: false },
    synthesizeResult: { summary: 'It is definitely 5 PM.' },
    builderPlan: { steps: [] },
  });
  assert.ok(result.issues.some((i) => i.category === 'calibration'));
  assert.ok(result.overall !== 'pass');
});

test('critic flags missing calculator for math mission', () => {
  const result = critique({
    mission: 'calculate 15 percent of 240',
    toolResults: {},
    verifyResult: { passed: false },
    synthesizeResult: { summary: '36' },
    builderPlan: { steps: [] },
  });
  assert.ok(result.issues.some((i) => i.category === 'coverage' && i.message.includes('calculator')));
});

test('critic passes when tools were used and verified', () => {
  const result = critique({
    mission: 'what is 6*7?',
    toolResults: { calculator: '42' },
    verifyResult: { passed: true, checks: [] },
    synthesizeResult: { summary: '6 times 7 is 42.' },
    builderPlan: { steps: [{ tool: 'calculator', args: { expression: '6*7' } }] },
  });
  assert.ok(result.canProceed);
  assert.ok(result.criticalCount === 0);
  assert.ok(result.highCount === 0);
});

test('quickCritique works standalone', () => {
  const result = quickCritique('hello', 'just a greeting');
  assert.ok(typeof result.overall === 'string');
  assert.ok(Array.isArray(result.issues));
});

test('critic rates thin results', () => {
  const result = critique({
    mission: 'do something',
    toolResults: { calculator: '4', clock: 'x' },
    verifyResult: { passed: true },
    synthesizeResult: { summary: 'done' },
    builderPlan: { steps: [] },
  });
  assert.ok(result.issues.some((i) => i.category === 'depth'));
});
