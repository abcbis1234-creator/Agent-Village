import test from 'node:test';
import assert from 'node:assert/strict';
import { SecurityReviewer, VERDICTS } from '../lib/security.mjs';

test('denies unknown tools', async () => {
  const s = new SecurityReviewer({});
  const d = await s.gate({ tool: 'rm_rf', args: {} });
  assert.equal(d.verdict, VERDICTS.DENY);
});
test('denies path traversal', async () => {
  const s = new SecurityReviewer({});
  const d = await s.gate({ tool: 'remember', args: { text: '../../etc/passwd' } });
  assert.equal(d.verdict, VERDICTS.DENY);
});
test('denies unexpected args', async () => {
  const s = new SecurityReviewer({});
  const d = await s.gate({ tool: 'calculator', args: { expression: '1+1', evil: 'x' } });
  assert.equal(d.verdict, VERDICTS.DENY);
});
test('guarded needs capability', async () => {
  const s = new SecurityReviewer({});
  const d = await s.gate({ tool: 'sd_generate', args: { prompt: 'cat' } });
  assert.equal(d.verdict, VERDICTS.REQUIRE_APPROVAL);
});
test('capability is single-use', async () => {
  const s = new SecurityReviewer({});
  const tok = s.mintCapability({ tool: 'sd_generate', scope: 'once', ttlMs: 5000 });
  const d1 = await s.gate({ tool: 'sd_generate', args: { prompt: 'cat' }, capabilityToken: tok });
  assert.notEqual(d1.verdict, VERDICTS.REQUIRE_APPROVAL);
  const d2 = await s.gate({ tool: 'sd_generate', args: { prompt: 'cat' }, capabilityToken: tok });
  assert.equal(d2.verdict, VERDICTS.REQUIRE_APPROVAL);
});
test('decision is signed', async () => {
  const s = new SecurityReviewer({});
  const d = await s.gate({ tool: 'calculator', args: { expression: '1+1' } });
  assert.ok(d.signature && d.signature.length === 32);
});