import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, SCHEMA_VERSION } from '../lib/store.mjs';

async function tmpPath() {
  const dir = await mkdtemp(join(tmpdir(), 'av-store-'));
  return join(dir, 'state.json');
}

test('fresh store has schema version and defaults', async () => {
  const s = new Store(await tmpPath());
  await s.load();
  assert.equal(s.version, SCHEMA_VERSION);
  assert.deepEqual(s.data.wants, []);
  assert.deepEqual(s.data.audit, []);
});

test('round-trip preserves data and stamps version', async () => {
  const path = await tmpPath();
  const s = new Store(path);
  await s.load();
  await s.createConversation({ agentId: 'planner', title: 't', user: 'anon' });
  await s.addMemoryRecord({ id: 'm1', text: 'hello', user: 'anon' });
  await s.save();

  const s2 = new Store(path);
  await s2.load();
  assert.equal(s2.version, SCHEMA_VERSION);
  assert.equal(s2.listMemories('anon').length, 1);
  assert.equal(s2.listConversations('anon').length, 1);

  const onDisk = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(onDisk.version, SCHEMA_VERSION);
});

test('legacy v0 store is migrated to current schema and backed up', async () => {
  const path = await tmpPath();
  // Write a legacy store with no version field and a missing collection.
  await writeFile(path, JSON.stringify({
    conversations: {},
    memories: [{ id: 'old', text: 'legacy', user: 'anon' }],
    // runs/events/checkpoints/wants/world/audit intentionally missing
  }));

  const s = new Store(path);
  await s.load();
  assert.equal(s.version, SCHEMA_VERSION);
  assert.equal(s.data.memories.length, 1);
  assert.deepEqual(s.data.wants, []);
  assert.deepEqual(s.data.audit, []);
  assert.deepEqual(s.data.checkpoints, {});

  // A backup of the pre-migration file should exist.
  const bak = await readFile(`${path}.bak`, 'utf8');
  assert.equal(JSON.parse(bak).version, undefined);
});

test('newer-than-supported store is refused', async () => {
  const path = await tmpPath();
  await writeFile(path, JSON.stringify({ version: SCHEMA_VERSION + 1, conversations: {} }));
  const s = new Store(path);
  await assert.rejects(() => s.load(), /newer than supported/);
});

test('corrupt store is preserved and load rejects', async () => {
  const path = await tmpPath();
  await writeFile(path, '{ this is not valid json ');
  const s = new Store(path);
  await assert.rejects(() => s.load(), /corrupt/);
});

test('concurrent saves serialize without losing the final state', async () => {
  const path = await tmpPath();
  const s = new Store(path);
  await s.load();
  // Fire many saves concurrently; each queues through the save chain.
  const writes = [];
  for (let i = 0; i < 25; i++) {
    s.data.wants.push({ id: `w${i}`, text: `want ${i}`, user: 'anon', status: 'open' });
    writes.push(s.save());
  }
  await Promise.all(writes);
  const s2 = new Store(path);
  await s2.load();
  assert.equal(s2.data.wants.length, 25, 'all queued writes persisted');
});

test('tmp files are cleaned up after saves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'av-store-'));
  const path = join(dir, 'state.json');
  const s = new Store(path);
  await s.load();
  await s.createConversation({ agentId: 'planner', title: 't', user: 'anon' });
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);
  assert.deepEqual(files, ['state.json'], 'no leftover .tmp files');
  await rm(dir, { recursive: true, force: true });
});

test('audit hash chain verifies and detects tampering', async () => {
  const s = new Store(await tmpPath());
  await s.load();
  assert.deepEqual(s.verifyAuditChain(), { ok: true, count: 0 });

  const a = await s.writeAudit({ verdict: 'allow', tool: 'clock', user: 'anon' });
  const b = await s.writeAudit({ verdict: 'deny', tool: 'sd_generate', user: 'anon' });
  const c = await s.writeAudit({ verdict: 'require_approval', tool: 'external_http', user: 'anon' });

  // Genesis record links to the zero prevHash.
  assert.equal(a.prevHash, '0'.repeat(64));
  assert.equal(a.seq, 1);
  // Each record links to the previous hash.
  assert.equal(b.prevHash, a.hash);
  assert.equal(c.prevHash, b.hash);

  const ok = s.verifyAuditChain();
  assert.deepEqual(ok, { ok: true, count: 3 });

  // Tamper with the middle record and confirm detection.
  s.data.audit[1].tool = 'rm -rf';
  const bad = s.verifyAuditChain();
  assert.equal(bad.ok, false);
  assert.equal(bad.brokenAt, 1);
  assert.match(bad.reason, /hash mismatch/);
});

test('audit chain survives save/load round-trip', async () => {
  const path = await tmpPath();
  const s = new Store(path);
  await s.load();
  await s.writeAudit({ verdict: 'allow', tool: 'clock', user: 'anon' });
  await s.writeAudit({ verdict: 'deny', tool: 'sd_generate', user: 'anon' });

  const s2 = new Store(path);
  await s2.load();
  const v = s2.verifyAuditChain();
  assert.equal(v.ok, true);
  assert.equal(v.count, 2);
});