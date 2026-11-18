import test from 'node:test';
import assert from 'node:assert/strict';
import { runCouncil } from '../studio/council.mjs';

const assignments = ['nova','atlas','lyra','forge','echo'].map((role) => ({ role, provider: 'ollama' }));
const env = {};

test('live council calls four specialists and a separate reviewer', async () => {
  const prompts = [];
  const result = await runCouncil({
    mission: 'Design a safe learning app',
    assignments,
    env,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      prompts.push(body.messages[1].content);
      return new Response(JSON.stringify({ message: { content: 'Contribution ' + prompts.length } }));
    }
  });
  assert.equal(result.mode, 'live-model-calls');
  assert.equal(result.reports.length, 5);
  assert.equal(result.reports[4].role.id, 'echo');
  assert.match(prompts[4], /Contribution 1/);
  assert.match(prompts[4], /independent review/i);
  assert.equal(result.approvalRequired, true);
});

test('council rejects missing role assignments before provider calls', async () => {
  await assert.rejects(runCouncil({ mission: 'x', assignments: [], fetchImpl: () => { throw new Error('must not call'); } }), /five agents/);
});

test('council rejects unknown providers before provider calls', async () => {
  const bad = assignments.map((item) => ({ ...item }));
  bad[0].provider = 'unknown';
  await assert.rejects(runCouncil({ mission: 'x', assignments: bad, fetchImpl: () => { throw new Error('must not call'); } }), /Unsupported provider/);
});

test('approved guidance is included in specialist and reviewer context', async () => {
  const prompts = [];
  await runCouncil({
    mission: 'Prepare a project plan',
    assignments,
    guidance: 'When planning, include measurable acceptance criteria and test each milestone.',
    env,
    fetchImpl: async (_url, options) => {
      prompts.push(JSON.parse(options.body).messages[1].content);
      return new Response(JSON.stringify({ message: { content: 'Reviewed contribution' } }));
    }
  });
  assert.equal(prompts.length, 5);
  assert.ok(prompts.every((prompt) => prompt.includes('APPROVED TEAM GUIDANCE')));
  assert.ok(prompts.every((prompt) => prompt.includes('measurable acceptance criteria')));
});
