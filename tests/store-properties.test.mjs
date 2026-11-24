import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../lib/store.mjs';

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), 'av-prop-'));
  const s = new Store(join(dir, 'state.json'));
  await s.load();
  return s;
}

// Property: N concurrent saves never lose a record and the final on-disk state
// matches the in-memory state.
test('property: concurrent writes are not lost', async () => {
  const s = await freshStore();
  const N = 50;
  const writes = [];
  for (let i = 0; i < N; i++) {
    s.data.wants.push({ id: `w${i}`, text: `want ${i}`, user: 'anon', status: 'open' });
    writes.push(s.save());
  }
  await Promise.all(writes);
  await s.flush();
  const s2 = await freshStore();
  // load from same path
  const dir = s.path;
  const s3 = new Store(dir);
  await s3.load();
  assert.equal(s3.data.wants.length, N, 'all concurrent writes persisted');
});

// Property: conversation status transitions are valid (open -> claimed ->
// fulfilled/cancelled; no skipping).
test('property: want status transitions are valid', async () => {
  const s = await freshStore();
  const { WantBoard } = await import('../lib/wants.mjs');
  const b = new WantBoard(s);
  const w = b.post({ text: 'build a site' });
  assert.equal(w.status, 'open');
  // Cannot fulfill before claiming.
  assert.throws(() => b.fulfill(w.id, { result: 'x' }), /must be claimed/);
  b.claim(w.id, { by: 'builder' });
  assert.equal(b.get(w.id).status, 'claimed');
  // Cannot claim twice.
  assert.throws(() => b.claim(w.id), /claimed/);
  b.fulfill(w.id, { result: 'done' });
  assert.equal(b.get(w.id).status, 'fulfilled');
});

// Property: event seq is monotonic per run and contiguous.
test('property: event seq is monotonic and contiguous', async () => {
  const s = await freshStore();
  const run = s.createRun({ conversationId: 'c1', provider: 'mock', user: 'anon' });
  for (let i = 0; i < 10; i++) s.appendEvent(run.id, { type: 'phase', phase: `p${i}` });
  const events = s.listEvents(run.id);
  assert.equal(events.length, 10);
  for (let i = 0; i < events.length; i++) assert.equal(events[i].seq, i + 1, `seq at ${i}`);
});

// Property: audit chain verifies after many writes and breaks on any mutation.
test('property: audit chain stays valid across many writes', async () => {
  const s = await freshStore();
  for (let i = 0; i < 30; i++) await s.writeAudit({ verdict: i % 2 ? 'allow' : 'deny', tool: 'clock', user: 'anon' });
  assert.deepEqual(s.verifyAuditChain(), { ok: true, count: 30 });
  // Mutate one record deep in the chain.
  s.data.audit[10].verdict = 'allow';
  const v = s.verifyAuditChain();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 10);
});

// Property: timestamps are non-decreasing within a run's events.
test('property: event timestamps are non-decreasing', async () => {
  const s = await freshStore();
  const run = s.createRun({ conversationId: 'c1', provider: 'mock', user: 'anon' });
  for (let i = 0; i < 20; i++) s.appendEvent(run.id, { type: 'tick' });
  const events = s.listEvents(run.id);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].ts >= events[i - 1].ts, `ts monotonic at ${i}`);
});