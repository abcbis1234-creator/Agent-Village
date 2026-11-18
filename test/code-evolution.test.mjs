import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodeEvolutionStore } from '../studio/code-evolution.mjs';

const valid = {
  mission: 'Add a small, tested helper',
  rationale: 'The helper removes duplicated input validation and has focused unit coverage.',
  files: ['studio/example.mjs'],
  patch: '--- a/studio/example.mjs\n+++ b/studio/example.mjs\n@@ -0,0 +1,2 @@\n+export function example() {\n+  return true;\n+}\n'
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-village-evolution-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return createCodeEvolutionStore({ filePath: join(directory, 'proposals.json') });
}

test('stores proposals as pending and requires a human review decision', async (t) => {
  const store = await fixture(t);
  const proposal = await store.submit(valid);
  assert.equal(proposal.status, 'pending_review');
  assert.equal(proposal.evaluation.eligible, true);
  const reviewed = await store.review({ proposalId: proposal.id, decision: 'approve', reviewer: 'maintainer' });
  assert.equal(reviewed.status, 'approved_for_manual_application');
  assert.equal((await store.list()).length, 1);
});

test('rejects traversal, secrets, and paths outside the allowlist', async (t) => {
  const store = await fixture(t);
  for (const path of ['../server.mjs', '.env', 'package.json', 'studio/../../server.mjs', '.github/workflows/ci.yml']) {
    await assert.rejects(() => store.submit({ ...valid, files: [path], patch: valid.patch.replaceAll('studio/example.mjs', path) }));
  }
});

test('requires patch headers to match declared files', async (t) => {
  const store = await fixture(t);
  await assert.rejects(() => store.submit({ ...valid, files: ['studio/other.mjs'] }), /headers must match/);
});

test('prevents duplicate review and unknown proposal access', async (t) => {
  const store = await fixture(t);
  await assert.rejects(() => store.review({ proposalId: 'missing', decision: 'approve', reviewer: 'maintainer' }), /Unknown/);
  const proposal = await store.submit(valid);
  await store.review({ proposalId: proposal.id, decision: 'reject', reviewer: 'maintainer' });
  await assert.rejects(() => store.review({ proposalId: proposal.id, decision: 'approve', reviewer: 'maintainer' }), /already been reviewed/);
});

test('serializes concurrent submissions without losing proposals', async (t) => {
  const store = await fixture(t);
  const proposals = await Promise.all(Array.from({ length: 12 }, (_, index) => store.submit({ ...valid, mission: 'Proposal ' + index })));
  assert.equal(proposals.length, 12);
  assert.equal((await store.list()).length, 12);
});
