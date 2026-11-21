import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '../lib/workflow.mjs';
import { Budget } from '../lib/budget.mjs';
import { ApprovalQueue } from '../lib/policy.mjs';

test('runs DAG in dependency order', async () => {
  const order = [];
  const wf = new Workflow({
    name: 't',
    nodes: [
      { id: 'a', run: async () => { order.push('a'); return 'A'; } },
      { id: 'b', run: async () => { order.push('b'); return 'B'; } },
      { id: 'c', run: async () => { order.push('c'); return 'C'; } },
    ],
    edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }],
    budget: new Budget(),
    policy: new ApprovalQueue(),
  });
  const results = await wf.run();
  assert.equal(order.indexOf('c'), 2);
  assert.deepEqual(results, { a: 'A', b: 'B', c: 'C' });
});

test('budget aborts run', async () => {
  const budget = new Budget({ node_starts: 2 });
  const wf = new Workflow({
    name: 't',
    nodes: [1, 2, 3, 4].map((i) => ({ id: `n${i}`, run: async () => i })),
    budget,
    policy: new ApprovalQueue(),
  });
  await assert.rejects(() => wf.run(), /node_starts budget exceeded/);
});

test('cancel aborts in-flight nodes', async () => {
  let started = 0;
  const wf = new Workflow({
    name: 't',
    nodes: [{
      id: 'slow',
      run: async ({ signal }) => {
        started++;
        await new Promise((res, rej) => {
          signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          setTimeout(res, 10_000);
        });
      },
    }],
    budget: new Budget(),
    policy: new ApprovalQueue(),
  });
  const p = wf.run();
  await new Promise((r) => setTimeout(r, 20));
  wf.cancel('test');
  await assert.rejects(p, /test/);
  assert.equal(started, 1);
});

test('approval gate denies guarded tool', async () => {
  const policy = new ApprovalQueue({ autoApproveSafe: true });
  const wf = new Workflow({
    name: 't',
    nodes: [{
      id: 'img',
      tool: 'sd_generate',
      requiresApproval: true,
      run: async () => 'img',
    }],
    budget: new Budget(),
    policy,
  });
  const p = wf.run();
  await new Promise((r) => setTimeout(r, 10));
  const pending = policy.list();
  assert.equal(pending.length, 1);
  policy.decide(pending[0].id, { approved: false, reason: 'test' });
  await assert.rejects(p, /approval denied/);
});
