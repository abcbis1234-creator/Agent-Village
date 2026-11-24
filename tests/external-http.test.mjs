import test from 'node:test';
import assert from 'node:assert/strict';
import { runTool, TOOLS } from '../lib/tools.mjs';

test('external_http is registered as a guarded tool', () => {
  assert.ok(TOOLS.external_http);
  assert.equal(TOOLS.external_http.risk, 'guarded');
});

test('external_http denies when no allowlist is configured', async () => {
  delete process.env.EXTERNAL_HTTP_ALLOWLIST;
  await assert.rejects(() => runTool('external_http', { url: 'https://example.com' }), /no allowlist/);
});

test('external_http blocks private/loopback hosts', async () => {
  process.env.EXTERNAL_HTTP_ALLOWLIST = 'example.com,localhost';
  await assert.rejects(() => runTool('external_http', { url: 'http://127.0.0.1/' }), /private\/loopback/);
  await assert.rejects(() => runTool('external_http', { url: 'http://169.254.169.254/latest/meta-data/' }), /private\/loopback/);
});

test('external_http denies hosts outside the allowlist', async () => {
  process.env.EXTERNAL_HTTP_ALLOWLIST = 'example.com';
  await assert.rejects(() => runTool('external_http', { url: 'https://evil.test/' }), /not in allowlist/);
});

test('external_http rejects non-http schemes', async () => {
  process.env.EXTERNAL_HTTP_ALLOWLIST = 'example.com';
  await assert.rejects(() => runTool('external_http', { url: 'file:///etc/passwd' }), /http\(s\)/);
});