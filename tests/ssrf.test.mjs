import test from 'node:test';
import assert from 'node:assert/strict';

import { SecurityReviewer, isPrivateAddress, resolveSafeTarget, safeFetchText, VERDICTS } from '../lib/security.mjs';
import { TOOLS } from '../lib/tools.mjs';

test('private and special IPv4 ranges are rejected', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('private and special IPv6 ranges are rejected', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:c0a8:0101::1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('resolveSafeTarget pins a validated public address', async () => {
  const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  const target = await resolveSafeTarget('https://example.com/a?b=1', { resolver });
  assert.equal(target.hostname, 'example.com');
  assert.equal(target.port, 443);
  assert.equal(target.addresses[0].address, '93.184.216.34');
});

test('resolveSafeTarget rejects private answers, credentials, and odd ports', async () => {
  const privateResolver = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(() => resolveSafeTarget('https://example.com', { resolver: privateResolver }), /private or special/i);
  await assert.rejects(() => resolveSafeTarget('https://user:pass@example.com'), /credentials/i);
  await assert.rejects(() => resolveSafeTarget('https://example.com:2222'), /port 2222/i);
  await assert.rejects(() => resolveSafeTarget('ftp://example.com'), /http\(s\)/i);
});

test('a mixed DNS answer is rejected if any address is private', async () => {
  const resolver = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  await assert.rejects(() => resolveSafeTarget('https://example.com', { resolver }), /private or special/i);
});

test('safeFetchText refuses loopback before opening a socket', async () => {
  await assert.rejects(() => safeFetchText('http://127.0.0.1/'), /private or special/i);
  await assert.rejects(() => safeFetchText('http://localhost/'), /private or special/i);
});

test('external_http tool rejects private hosts even when allowlisted', async () => {
  const previous = process.env.EXTERNAL_HTTP_ALLOWLIST;
  process.env.EXTERNAL_HTTP_ALLOWLIST = 'localhost,127.0.0.1';
  try {
    await assert.rejects(() => TOOLS.external_http.run({ url: 'http://localhost/' }), /private\/loopback/i);
    await assert.rejects(() => TOOLS.external_http.run({ url: 'http://127.0.0.1/' }), /private\/loopback/i);
  } finally {
    if (previous === undefined) delete process.env.EXTERNAL_HTTP_ALLOWLIST;
    else process.env.EXTERNAL_HTTP_ALLOWLIST = previous;
  }
});

test('security gate denies an allowlisted host that resolves to loopback', async () => {
  const previous = process.env.EXTERNAL_HTTP_ALLOWLIST;
  process.env.EXTERNAL_HTTP_ALLOWLIST = 'localhost';
  try {
    const reviewer = new SecurityReviewer();
    const decision = await reviewer.gate({ tool: 'external_http', args: { url: 'http://localhost/' } });
    assert.equal(decision.verdict, VERDICTS.DENY);
    assert.ok(decision.reasons.some((r) => /unsafe target/i.test(r)), decision.reasons.join('; '));
  } finally {
    if (previous === undefined) delete process.env.EXTERNAL_HTTP_ALLOWLIST;
    else process.env.EXTERNAL_HTTP_ALLOWLIST = previous;
  }
});
