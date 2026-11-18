import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLearningStore } from '../studio/learning-loop.mjs';

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), 'agent-village-learning-'));
  try { await run(createLearningStore({ filePath: join(directory, 'learning.json') })); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('feedback creates an evaluated pending proposal; only approval activates guidance', async () => {
  await withStore(async (store) => {
    await store.recordSession({ id: 'session-1', mission: 'Improve a planning task', reports: [{ role: { id: 'nova' } }] });
    const submitted = await store.submitFeedback({
      sessionId: 'session-1', rating: 4, comment: 'The plan was useful but missed acceptance criteria.',
      improvement: 'When proposing a plan, include measurable acceptance criteria and a simple test for each milestone.'
    });
    assert.equal(submitted.feedback.rating, 4);
    assert.equal(submitted.proposal.status, 'pending');
    assert.equal(submitted.proposal.evaluation.eligible, true);
    assert.equal(await store.activeGuidance(), '');
    const decision = await store.decideProposal({ proposalId: submitted.proposal.id, decision: 'approve', reviewer: 'human' });
    assert.equal(decision.activeVersion.number, 1);
    assert.match(await store.activeGuidance(), /acceptance criteria/);
  });
});

test('quality gate blocks weak proposals and rejection never changes active guidance', async () => {
  await withStore(async (store) => {
    await store.recordSession({ id: 'session-2', mission: 'Test a task', reports: [] });
    const submitted = await store.submitFeedback({ sessionId: 'session-2', rating: 2, improvement: 'Do better.' });
    assert.equal(submitted.proposal.evaluation.eligible, false);
    await assert.rejects(store.decideProposal({ proposalId: submitted.proposal.id, decision: 'approve' }), /quality gate/);
    await store.decideProposal({ proposalId: submitted.proposal.id, decision: 'reject' });
    assert.equal(await store.activeGuidance(), '');
  });
});

test('approved guidance is versioned and can be rolled back', async () => {
  await withStore(async (store) => {
    await store.recordSession({ id: 'session-3', mission: 'Improve reports', reports: [] });
    const first = await store.submitFeedback({ sessionId: 'session-3', rating: 5, improvement: 'When writing a report, separate verified facts from assumptions and include a test for each important claim.' });
    const v1 = (await store.decideProposal({ proposalId: first.proposal.id, decision: 'approve' })).activeVersion;
    const second = await store.submitFeedback({ sessionId: 'session-3', rating: 5, improvement: 'When planning work, compare two reasonable approaches and explain the trade-offs before selecting one.' });
    const v2 = (await store.decideProposal({ proposalId: second.proposal.id, decision: 'approve' })).activeVersion;
    assert.notEqual(v1.id, v2.id);
    const rolledBack = await store.rollback({ reviewer: 'human' });
    assert.equal(rolledBack.activeVersion.id, v1.id);
    assert.match(await store.activeGuidance(), /verified facts/);
  });
});

test('unknown sessions and invalid ratings are rejected', async () => {
  await withStore(async (store) => {
    await assert.rejects(store.submitFeedback({ sessionId: 'missing', rating: 5 }), /Unknown session/);
    await store.recordSession({ id: 'session-4', mission: 'Task', reports: [] });
    await assert.rejects(store.submitFeedback({ sessionId: 'session-4', rating: 9 }), /rating must/);
  });
});
