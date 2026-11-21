import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRun, verifyArithmetic, verifyNoSecrets, verifyToolResults } from '../lib/verifier.mjs';

test('verifyArithmetic checks correctness', () => {
  assert.ok(verifyArithmetic('2+2', '4'));
  assert.ok(verifyArithmetic('(2+3)*4', '20'));
  assert.ok(!verifyArithmetic('2+2', '5'));
  assert.ok(!verifyArithmetic('2+', '4'));
});

test('verifyNoSecrets blocks leaked credentials', () => {
  assert.ok(verifyNoSecrets('The answer is 42.'));
  assert.ok(!verifyNoSecrets('My key is sk-1234567890.'));
  assert.ok(!verifyNoSecrets('Authorization: Bearer token123'));
  assert.ok(!verifyNoSecrets('The password is hunter2.'));
});

test('verifyToolResults flags empty and error results', () => {
  const result = verifyToolResults({ calculator: '4', clock: '2024-01-01' });
  assert.ok(result.passed);
  assert.equal(result.checks.length, 2);

  const bad = verifyToolResults({ calculator: '', sd_generate: 'Error: failed' });
  assert.ok(!bad.passed);
  assert.ok(bad.checks.some((c) => !c.pass));
});

test('verifyRun combines tool checks and secret scan', () => {
  const ok = verifyRun({ toolResults: { calculator: '42' }, mission: 'what is 6*7?' });
  assert.ok(ok.passed);

  const leaked = verifyRun({ toolResults: { calculator: 'sk-123' }, mission: 'compute' });
  assert.ok(!leaked.passed);
  assert.ok(leaked.checks.some((c) => c.name === 'no_secrets'));
});
