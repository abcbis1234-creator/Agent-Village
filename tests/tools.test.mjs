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