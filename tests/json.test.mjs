import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, extractAllJson, parseJson } from '../lib/json.mjs';

test('extracts JSON from a markdown fence', () => {
  const v = extractJson('Here you go:\n```json\n{"steps":[{"tool":"calculator","args":{"expression":"2+2"}}]}\n```');
  assert.equal(v.steps[0].tool, 'calculator');
});

test('repairs trailing commas and comments', () => {
  const v = extractJson('{"a":1, /* note */ "b":[1,2,],}');
  assert.equal(v.a, 1);
  assert.equal(v.b.length, 2);
});

test('repairs single quotes and unquoted keys', () => {
  const v = extractJson("{intent:'general', ambiguities:[]}");
  assert.equal(v.intent, 'general');
  assert.deepEqual(v.ambiguities, []);
});

test('closes truncated objects and strings', () => {
  const v = extractJson('{"steps":[{"tool":"calc');
  assert.equal(v.steps[0].tool, 'calc');
});

test('finds JSON surrounded by prose', () => {
  const v = extractJson('Sure! The plan is {"steps":[]} — done.');
  assert.deepEqual(v.steps, []);
});

test('prefers the real object over a prose bracket', () => {
  const v = extractJson('Use [this] format: {"steps":[{"tool":"clock","args":{}}]}');
  assert.equal(v.steps[0].tool, 'clock');
});

test('extractAllJson finds multiple objects', () => {
  const all = extractAllJson('{"a":1} and {"b":2}');
  assert.equal(all.length, 2);
});

test('does not pollute Object.prototype', () => {
  const v = extractJson('{"__proto__":{"polluted":true},"a":1}');
  assert.equal(v.a, 1);
  assert.equal({}.polluted, undefined);
});

test('enforces a depth limit', () => {
  const v = parseJson('[[[[1]]]]', { maxDepth: 2 });
  assert.equal(v, undefined);
});

test('normalizes literals and numbers', () => {
  const v = extractJson('{"n": 1e3, "ok": true, "x": undefined, "hex": 0x10}');
  assert.equal(v.n, 1000);
  assert.equal(v.ok, true);
  assert.equal(v.x, null);
  assert.equal(v.hex, 16);
});
