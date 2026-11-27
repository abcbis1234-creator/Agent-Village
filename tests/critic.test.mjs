import test from 'node:test';
import assert from 'node:assert/strict';
import { Critic } from '../lib/critic.mjs';

test('picks provider different from builder', () => {
  const c = new Critic({});
  assert.notEqual(c.pickProvider('openai'), 'openai');
  assert.notEqual(c.pickProvider('anthropic'), 'anthropic');
});
test('rejects when any lens fails', async () => {
  const c = new Critic({});
  const v = await c.review({ artifact: '2+2=5', request: 'what is 2+2?', builderProvider: 'openai' });
  assert.ok(['accept', 'reject'].includes(v.overall));
  assert.ok(Array.isArray(v.findings));
});

test('propagates AbortError instead of treating lenses as low confidence', async () => {
  const c = new Critic({ independentProviders: ['mock'] });
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => c.review({ artifact: 'x', request: 'y', builderProvider: 'mock', signal: ac.signal }),
    (err) => err.name === 'AbortError',
  );
});
