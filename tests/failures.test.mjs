import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FAILURE_CODES, classifyFailure, isFailureCategory, isFailureEvent } from '../lib/failures.mjs';
import { Store } from '../lib/store.mjs';
import { orchestrate } from '../lib/orchestrator.mjs';

test('every taxonomy code has a known category', () => {
  for (const [code, meta] of Object.entries(FAILURE_CODES)) {
    assert.ok(isFailureCategory(meta.category), `${code} has category ${meta.category}`);
    assert.equal(typeof meta.retryable, 'boolean', code);
    assert.ok(meta.description.length > 0, code);
  }
});

test('classifies planning, tool, retrieval, formatting, safety, and infra failures', () => {
  assert.equal(classifyFailure({ code: 'PLAN_INVALID' }).category, 'planning');
  assert.equal(classifyFailure({ type: 'tool_error', tool: 'calculator', error: 'bad expression' }).code, 'TOOL_FAILED');
  assert.equal(classifyFailure({ type: 'tool_error', tool: 'external_http', error: 'request timed out' }).code, 'TOOL_TIMEOUT');
  assert.equal(classifyFailure({ where: 'scout', message: 'retrieval returned nothing' }).category, 'retrieval');
  assert.equal(classifyFailure({ message: 'unexpected token in JSON' }).code, 'FORMAT_INVALID_JSON');
  assert.equal(classifyFailure({ type: 'security_block', tool: 'recall' }).code, 'SAFETY_QUARANTINE');
  assert.equal(classifyFailure({ name: 'AbortError', message: 'aborted' }).code, 'CANCELLED');
  assert.equal(classifyFailure({ message: 'latency budget exceeded' }).code, 'BUDGET_EXCEEDED');
  assert.equal(classifyFailure(new Error('socket hang up')).category, 'infra');
  assert.equal(classifyFailure({}).code, 'INTERNAL');
});

test('failure events are explicit', () => {
  for (const type of ['error', 'tool_error', 'security_block', 'phase_gate_failed', 'interrupted']) {
    assert.equal(isFailureEvent({ type }), true, type);
  }
  assert.equal(isFailureEvent({ type: 'phase' }), false);
  assert.equal(isFailureEvent({ type: 'tool_result' }), false);
});

test('orchestrate attaches a taxonomy failure to a phase-gate event', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'av-fail-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  const run = store.createRun({ conversationId: 'c1', provider: 'mock' });
  const events = [];
  await assert.rejects(async () => {
    for await (const evt of orchestrate({ message: '', provider: 'mock', store, conversationId: 'c1', runId: run.id })) events.push(evt);
  }, /gate failed/);
  const gateEvent = events.find((e) => e.type === 'phase_gate_failed');
  assert.ok(gateEvent);
  assert.equal(gateEvent.failure.code, 'GATE_FAILED');
  assert.equal(gateEvent.failure.category, 'planning');
});
