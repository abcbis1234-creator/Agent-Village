import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTraces, exportTracesToFile, traceStats } from '../lib/training/trace-export.mjs';

// Minimal mock store implementing the Store interface used by trace-export.
function makeStore(runs = []) {
  const eventsByRun = new Map();
  return {
    listRuns: (opts = {}) => {
      let filtered = [...runs];
      if (opts.user) filtered = filtered.filter((r) => r.user === opts.user);
      if (opts.sinceMs) filtered = filtered.filter((r) => r.createdAt >= opts.sinceMs);
      if (opts.status) filtered = filtered.filter((r) => r.status === opts.status);
      return filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, opts.limit ?? 100);
    },
    listEvents: (runId) => eventsByRun.get(runId) ?? [],
    getRun: (runId) => runs.find((r) => r.id === runId) ?? null,
  };
}

function makeRun(id, mission, status = 'ok', provider = 'mock', user = 'anon', createdAt = Date.now()) {
  return { id, mission, status, provider, user, createdAt, conversationId: `conv-${id}` };
}

function makeEvents(runId, ...types) {
  const events = [];
  let seq = 0;
  for (const type of types) {
    seq++;
    events.push({ type, payload: {}, seq, ts: Date.now() });
  }
  return events;
}

test('exportTraces returns JSONL string', async () => {
  const store = makeStore([
    makeRun('r1', 'what is 2+2?', 'ok', 'mock', 'u1'),
  ]);
  // Add events: planner + tool + verifier pass + synthesizer + critic pass + message_end
  store.listEvents = () => [
    { type: 'planner_raw', payload: { steps: [{ tool: 'calculator', args: { expression: '2+2' } }] }, seq: 1 },
    { type: 'tool_call', payload: { tool: 'calculator', args: { expression: '2+2' } }, seq: 2 },
    { type: 'tool_result', payload: { tool: 'calculator', result: '4' }, seq: 3 },
    { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 4 },
    { type: 'synthesize_result', payload: { summary: '4', evidence_table: [], risks: [], recommendations: [] }, seq: 5 },
    { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 6 },
    { type: 'message_end', payload: { content: '4' }, seq: 7 },
  ];

  const jsonl = await exportTraces(store);
  const lines = jsonl.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  const example = JSON.parse(lines[0]);
  assert.ok(example.messages);
  assert.ok(example._meta);
  assert.strictEqual(example._meta.runId, 'r1');
  assert.strictEqual(example._meta.verdict, 'accept');
});

test('exportTraces filters out failed runs', async () => {
  const store = makeStore([
    makeRun('r1', 'good run', 'ok', 'mock', 'u1'),
    makeRun('r2', 'bad run', 'error', 'mock', 'u1'),
  ]);
  // r1: good events
  store.listEvents = (id) => {
    if (id === 'r1') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 3 },
        { type: 'message_end', payload: { content: 'ok' }, seq: 4 },
      ];
    }
    if (id === 'r2') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: false, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 3 },
        { type: 'message_end', payload: { content: 'bad' }, seq: 4 },
      ];
    }
    return [];
  };

  const jsonl = await exportTraces(store);
  const lines = jsonl.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1); // only r1 exported
  const example = JSON.parse(lines[0]);
  assert.strictEqual(example._meta.runId, 'r1');
});

test('exportTraces filters out critic-rejected runs', async () => {
  const store = makeStore([
    makeRun('r1', 'good', 'ok', 'mock', 'u1'),
    makeRun('r2', 'bad', 'ok', 'mock', 'u1'),
  ]);
  store.listEvents = (id) => {
    if (id === 'r1') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 3 },
        { type: 'message_end', payload: { content: 'ok' }, seq: 4 },
      ];
    }
    if (id === 'r2') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'reject', issues: [], criticalCount: 1, highCount: 0 }, seq: 3 },
        { type: 'message_end', payload: { content: 'bad' }, seq: 4 },
      ];
    }
    return [];
  };

  const jsonl = await exportTraces(store);
  const lines = jsonl.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  const example = JSON.parse(lines[0]);
  assert.strictEqual(example._meta.runId, 'r1');
});

test('exportTraces filters by capability', async () => {
  const store = makeStore([
    makeRun('r1', 'what is 2+2?', 'ok', 'mock', 'u1'),
    makeRun('r2', 'what time is it?', 'ok', 'mock', 'u1'),
  ]);
  store.listEvents = (id) => [
    { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
    { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
    { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 3 },
    { type: 'message_end', payload: { content: 'ok' }, seq: 4 },
  ];

  const jsonl = await exportTraces(store, { capability: 'calculator' });
  const lines = jsonl.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  const example = JSON.parse(lines[0]);
  assert.strictEqual(example._meta.capability, 'calculator');
});

test('exportTraces filters by minQuality', async () => {
  const store = makeStore([
    makeRun('r1', 'high quality', 'ok', 'mock', 'u1'),
    makeRun('r2', 'low quality', 'ok', 'mock', 'u1'),
  ]);
  store.listEvents = (id) => {
    if (id === 'r1') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0, confidence: 0.9 }, seq: 3 },
        { type: 'message_end', payload: { content: 'ok' }, seq: 4 },
      ];
    }
    if (id === 'r2') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0, confidence: 0.3 }, seq: 3 },
        { type: 'message_end', payload: { content: 'ok' }, seq: 4 },
      ];
    }
    return [];
  };

  const jsonl = await exportTraces(store, { minQuality: 0.8 });
  const lines = jsonl.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  const example = JSON.parse(lines[0]);
  assert.ok(example._meta.confidence >= 0.8);
});

test('exportTracesToFile writes JSONL to disk', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'av-trace-'));
  const filePath = join(dir, 'traces.jsonl');

  const store = makeStore([
    makeRun('r1', 'what is 2+2?', 'ok', 'mock', 'u1'),
  ]);
  store.listEvents = () => [
    { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
    { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
    { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 3 },
    { type: 'message_end', payload: { content: '4' }, seq: 4 },
  ];

  const result = await exportTracesToFile(store, filePath);
  assert.ok(result.count >= 1);
  assert.strictEqual(result.filePath, filePath);

  const { readFile } = await import('node:fs/promises');
  const content = await readFile(filePath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  assert.ok(JSON.parse(lines[0])._meta);
});

test('traceStats returns run statistics', async () => {
  const store = makeStore([
    makeRun('r1', 'calculate 2+2', 'ok', 'mock', 'u1'),
    makeRun('r2', 'bad run', 'error', 'mock', 'u1'),
  ]);
  store.listEvents = (id) => {
    if (id === 'r1') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: true, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'accept', issues: [], criticalCount: 0, highCount: 0 }, seq: 3 },
        { type: 'message_end', payload: { content: 'ok' }, seq: 4 },
      ];
    }
    if (id === 'r2') {
      return [
        { type: 'planner_raw', payload: { steps: [] }, seq: 1 },
        { type: 'verify_result', payload: { passed: false, checks: [] }, seq: 2 },
        { type: 'critic_result', payload: { overall: 'reject', issues: [], criticalCount: 1, highCount: 0 }, seq: 3 },
        { type: 'message_end', payload: { content: 'bad' }, seq: 4 },
      ];
    }
    return [];
  };

  const stats = await traceStats(store);
  assert.strictEqual(stats.totalRuns, 2);
  assert.strictEqual(stats.exportableRuns, 1);
  assert.strictEqual(stats.exportableRate, 50);
  assert.ok(stats.byCapability.calculator === 1);
});

test('traceStats returns zero for empty store', async () => {
  const store = makeStore([]);
  const stats = await traceStats(store);
  assert.strictEqual(stats.totalRuns, 0);
  assert.strictEqual(stats.exportableRuns, 0);
  assert.strictEqual(stats.exportableRate, 0);
});
