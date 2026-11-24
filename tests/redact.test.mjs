import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactError, containsSecret } from '../lib/redact.mjs';

test('redactString masks common secret shapes', () => {
  assert.equal(containsSecret('key sk-abcdefghijklmnopqrstuvwx'), true);
  const out = redact('my key is sk-abcdefghijklmnopqrstuvwx ok');
  assert.ok(!out.includes('sk-abcdefghijklmnopqrstuvwx'));
  assert.ok(out.includes('[REDACTED_KEY]'));
});

test('redact masks bearer tokens and private keys', () => {
  assert.ok(redact('Authorization: Bearer abcdefghijklmnop123456').includes('[REDACTED]'));
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\n-----END RSA PRIVATE KEY-----';
  assert.ok(redact(pem).includes('[REDACTED_PRIVATE_KEY]'));
});

test('redact recurses into objects and masks sensitive keys', () => {
  const input = { user: 'anon', api_key: 'sk-supersecretvalue123456', nested: { password: 'hunter2' }, list: ['sk-anothersecretvalue1234'] };
  const out = redact(input);
  assert.equal(out.api_key, '[REDACTED]');
  assert.equal(out.nested.password, '[REDACTED]');
  assert.ok(out.list[0].includes('[REDACTED'));
  assert.equal(out.user, 'anon');
  // input is not mutated
  assert.equal(input.api_key, 'sk-supersecretvalue123456');
});

test('redactError returns a safe plain object', () => {
  const err = new Error('failed with sk-abcdefghijklmnopqrstuvwx');
  const out = redactError(err);
  assert.equal(typeof out, 'object');
  assert.ok(!out.message.includes('sk-abcdefghijklmnopqrstuvwx'));
  assert.ok(out.message.includes('[REDACTED_KEY]'));
});

test('redact handles circular-ish depth and non-plain values', () => {
  assert.doesNotThrow(() => redact({ d: new Date() }));
  assert.equal(typeof redact(42), 'number');
  assert.equal(redact(null), null);
});