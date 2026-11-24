import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateIdeas, parseIdeas } from '../scripts/ideas.mjs';

test('the idea catalog validates end to end', async () => {
  const result = await validateIdeas();
  assert.deepEqual(result.errors, [], result.errors.join('\n'));
  assert.equal(result.ok, true);
});

test('catalog contains at least 1000 ideas with every category populated', async () => {
  const { total, perFile } = await validateIdeas();
  assert.ok(total >= 1000, `expected >= 1000 ideas, found ${total}`);
  assert.equal(perFile.length, 12);
  for (const file of perFile) {
    assert.ok(file.count >= 50, `${file.file} has only ${file.count} ideas`);
    assert.equal(file.count, file.declared, `${file.file} title count is stale`);
  }
});

test('parseIdeas extracts a well-formed row', () => {
  const md = [
    '| ID | Idea | What it adds | Where | Effort | Source |',
    '|---|---|---|---|---|---|',
    '| TEST-001 | Do a thing | It adds a thing | `lib/x.mjs` | S | Invented |',
  ].join('\n');
  const { rows, errors } = parseIdeas(md);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'TEST-001');
  assert.equal(rows[0].effort, 'S');
  assert.equal(rows[0].columns, 6);
});

test('parseIdeas reports rows with the wrong column count', () => {
  const md = '| TEST-001 | Only three | `lib/x.mjs` | S |';
  const { errors } = parseIdeas(md);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /expected 6 columns/);
});

test('parseIdeas ignores headers and separators', () => {
  const md = [
    '| ID | Idea | What it adds | Where | Effort | Source |',
    '|---|---|---|---|---|---|',
    '| TEST-001 | Real row | Detail | `x` | M | Invented |',
  ].join('\n');
  const { rows } = parseIdeas(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'TEST-001');
});
