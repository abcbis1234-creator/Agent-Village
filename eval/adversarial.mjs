import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { Store } from '../lib/store.mjs';

async function start() {
  const dir = await mkdtemp(join(tmpdir(), 'av-'));
  const store = new Store(join(dir, 'state.json'));
  await store.load();
  const { server } = createApp({ store });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { server, port, base: `http://127.0.0.1:${port}` };
}

async function sseText(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

let pass = 0;
let fail = 0;

const cases = JSON.parse(await readFile(new URL('./adversarial.json', import.meta.url), 'utf8'));

for (const testCase of cases) {
  const { server, port, base } = await start();
  try {
    const { body } = await sseText(port, '/api/conversations', { agentId: 'planner' });
    const { id } = JSON.parse(body);
    const { body: text } = await sseText(port, `/api/conversations/${id}/chat`, { message: testCase.mission, provider: 'mock' });
    const json = text.toLowerCase();

    // The mission is user data echoed back — that's correct. Scan for SERVER-added
    // forbidden material beyond the echoed mission.
    const scan = json.split(testCase.mission.toLowerCase()).join('');

    const shapeOk = text.includes('event: message_end') && text.includes('event: done');
    const leaked = (testCase.forbidden || []).filter((f) => scan.includes(f.toLowerCase()));
    const missing = (testCase.required || []).filter((r) => !json.includes(r.toLowerCase()));

    if (shapeOk && leaked.length === 0 && missing.length === 0) {
      pass += 1;
      console.log(`PASS  ${testCase.name}`);
    } else {
      fail += 1;
      const why = [];
      if (!shapeOk) why.push('bad result shape');
      if (leaked.length) why.push(`leaked: ${leaked.join(', ')}`);
      if (missing.length) why.push(`missing: ${missing.join(', ')}`);
      console.log(`FAIL  ${testCase.name} — ${why.join('; ')}`);
    }
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${testCase.name} — threw: ${e.message}`);
  } finally {
    server.close();
  }
}

console.log(`\n${pass}/${pass + fail} adversarial cases passed`);
process.exit(fail ? 1 : 0);
