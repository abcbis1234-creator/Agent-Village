import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool } from '../lib/tools.mjs';

test('calculator basic', async () => {
  assert.equal(await runTool('calculator', { expression: '2+2' }), 4);
  assert.equal(await runTool('calculator', { expression: '(2+3)*4' }), 20);
  assert.equal(await runTool('calculator', { expression: '-5 + 3' }), -2);
});
test('calculator rejects malformed', async () => {
  await assert.rejects(() => runTool('calculator', { expression: '2+' }), /unexpected|end/);
});
test('unknown tool throws', async () => {
  await assert.rejects(() => runTool('nope', {}), /unknown tool/);
});
test('storyboard tool returns a compact, deterministic plan', async () => {
  const args = { brief: 'A 30 second premium promo for my coffee shop', durationSeconds: 30, scenes: 6, seed: 'tool-test' };
  const first = await runTool('storyboard', args);
  const second = await runTool('storyboard', args);
  assert.equal(first, second);
  assert.match(first, /^STORYBOARD · Coffee Shop in 30 Seconds/);
  assert.match(first, /30s · 9:16 · TikTok · 30 fps · 6 scenes/);
  assert.match(first, /Open \/director\.html/);
});
