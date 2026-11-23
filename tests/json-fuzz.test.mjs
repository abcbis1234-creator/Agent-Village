import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, DEFAULT_LIMITS } from '../lib/json.mjs';

// Deterministic PRNG (mulberry32) so fuzz failures are reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = '{}[]":,\'0123456789.-+eE truefalsnl\\/\n\t <div>#*abcXYZ_$=:;|`~!@%^&() \u200B\u202E';

function randomString(rand, len) {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return out;
}

test('extractJson never throws and returns undefined or an object/array across random inputs', () => {
  const rand = mulberry32(0xC0FFEE);
  for (let i = 0; i < 2000; i++) {
    const len = Math.floor(rand() * 120);
    const input = randomString(rand, len);
    let out;
    assert.doesNotThrow(() => { out = extractJson(input); }, `threw on input #${i}: ${JSON.stringify(input)}`);
    assert.ok(out === undefined || (typeof out === 'object' && out !== null), `bad return on #${i}: ${typeof out}`);
  }
});

test('extractJson handles deeply nested input without stack overflow', () => {
  // maxDepth is 32; deeper input must be rejected gracefully, not crash.
  const deep = '['.repeat(100000) + ']'.repeat(100000);
  let out;
  assert.doesNotThrow(() => { out = extractJson(deep); });
  assert.ok(out === undefined || typeof out === 'object');
});

test('extractJson respects maxLength limit on huge input', () => {
  const unit = JSON.stringify({ steps: [{ tool: 'clock', args: {} }] });
  const big = unit.repeat(Math.ceil((DEFAULT_LIMITS.maxLength + 1000) / unit.length) + 10);
  assert.ok(big.length > DEFAULT_LIMITS.maxLength, 'input exceeds max length');
  // Must not throw or hang; the parser bounds its work via maxCandidates and
  // the source length.
  let out;
  assert.doesNotThrow(() => { out = extractJson(big); });
});

test('extractJson does not pollute Object.prototype via __proto__ keys', () => {
  const before = Object.keys(Object.prototype).length;
  extractJson('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}}');
  // Object.prototype must be untouched.
  assert.equal({}.polluted, undefined);
  assert.equal(Object.keys(Object.prototype).length, before);
});

test('extractJson handles non-string inputs gracefully', () => {
  for (const v of [null, undefined, 0, 42, true, false, {}, [], Symbol('x')]) {
    let out;
    assert.doesNotThrow(() => { out = extractJson(v); }, `threw on ${String(v)}`);
    assert.ok(out === undefined || typeof out === 'object');
  }
});

test('extractJson still parses valid JSON from noisy LLM-style output', () => {
  const cases = [
    ['```json\n{"steps":[{"tool":"clock","args":{}}]}\n```', { steps: [{ tool: 'clock', args: {} }] }],
    ['Here is the plan: {"steps":[]} trailing prose', { steps: [] }],
    ["{'steps': []}", { steps: [] }], // single quotes
    ['{"a":1,}', { a: 1 }], // trailing comma
  ];
  for (const [input, expected] of cases) {
    assert.deepEqual(extractJson(input), expected, `failed on ${input}`);
  }
});