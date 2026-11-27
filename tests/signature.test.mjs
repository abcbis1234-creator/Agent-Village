import test from 'node:test';
import assert from 'node:assert/strict';
import { signExport, verifyExport } from '../lib/signature.mjs';

test('signs and verifies with the configured secret', () => {
  const previous = process.env.VILLAGE_EXPORT_SECRET;
  process.env.VILLAGE_EXPORT_SECRET = 'unit-test-secret';
  try {
    const signed = signExport({ run: 'r1', ok: true });
    assert.equal(signed.alg, 'HS256');
    assert.equal(verifyExport(signed), true);
    assert.equal(verifyExport({ body: signed.body, sig: '00' }), false);
    assert.equal(verifyExport({ body: signed.body + 'x', sig: signed.sig }), false);
  } finally {
    if (previous === undefined) delete process.env.VILLAGE_EXPORT_SECRET;
    else process.env.VILLAGE_EXPORT_SECRET = previous;
  }
});

test('refuses to use a public default when the secret is unset', () => {
  const previous = process.env.VILLAGE_EXPORT_SECRET;
  delete process.env.VILLAGE_EXPORT_SECRET;
  try {
    assert.throws(() => signExport({ a: 1 }), /VILLAGE_EXPORT_SECRET/);
    assert.equal(verifyExport({ body: '{}', sig: '00' }), false);
  } finally {
    if (previous === undefined) delete process.env.VILLAGE_EXPORT_SECRET;
    else process.env.VILLAGE_EXPORT_SECRET = previous;
  }
});
