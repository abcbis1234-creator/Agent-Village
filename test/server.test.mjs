import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server } from '../server.mjs';

function request(port, path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        if (data) { try { parsed = JSON.parse(data); } catch {} }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

test('Agent Village API, static serving, and security guards', async (t) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const health = await request(port, '/api/health');
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.ok, true);
  assert.ok(Number.isInteger(health.body.capabilities) && health.body.capabilities > 0);

  const caps = await request(port, '/api/capabilities');
  assert.strictEqual(caps.status, 200);
  assert.ok(Array.isArray(caps.body.capabilities));
  assert.ok(caps.body.capabilities.some((c) => c.key === 'code'));

  const contract = await request(port, '/api/agent-contract');
  assert.strictEqual(contract.status, 200);
  assert.strictEqual(contract.body.version, '1.0');
  assert.ok(contract.body.endpoints);

  const run = await request(port, '/api/run', 'POST', { mission: 'Create a webnovel about a builder', capability: 'auto', rounds: 1 });
  assert.strictEqual(run.status, 200);
  assert.ok(run.body.id);
  assert.strictEqual(run.body.mission, 'Create a webnovel about a builder');
  assert.ok(run.body.deliverable && run.body.deliverable.sections);
  assert.ok(Array.isArray(run.body.reports) && run.body.reports.length > 0);
  assert.ok(run.body.verdict && run.body.verdict.decision && run.body.verdict.rationale);

  const run2 = await request(port, '/api/run', 'POST', { mission: 'Plan a launch', rounds: 5 });
  assert.strictEqual(run2.status, 200);
  assert.strictEqual(run2.body.rounds, 3);

  const bad = await request(port, '/api/run', 'POST', { mission: '' });
  assert.strictEqual(bad.status, 400);

  const bad2 = await request(port, '/api/run', 'POST', {});
  assert.strictEqual(bad2.status, 400);

  const long = await request(port, '/api/run', 'POST', { mission: 'x'.repeat(1201) });
  assert.strictEqual(long.status, 400);

  const index = await request(port, '/');
  assert.strictEqual(index.status, 200);
  assert.ok(typeof index.body === 'string' && index.body.includes('AGENT VILLAGE'));

  const traversal = await request(port, '/../../etc/passwd');
  assert.strictEqual(traversal.status, 403);

  const missing = await request(port, '/api/nope');
  assert.strictEqual(missing.status, 404);
});
