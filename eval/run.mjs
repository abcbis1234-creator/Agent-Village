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

async function postJson(port, path, body) {
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

async function sseText(port, path, body) {
    const res = await postJson(port, path, body);
    if (res.status !== 200 && res.status !== 201) throw new Error(`HTTP ${res.status}: ${res.body}`);
    return res.body;
}

let pass = 0;
let fail = 0;

const golden = JSON.parse(await readFile(new URL('./golden.json', import.meta.url), 'utf8'));

for (const { mission, expect } of golden) {
  const { server, port, base } = await start();
  try {
    const { id } = JSON.parse((await postJson(port, '/api/conversations', { agentId: 'planner' })).body);
    const text = await sseText(port, `/api/conversations/${id}/chat`, { message: mission, provider: 'mock' });
    const hasDone = text.includes('event: done');
    const hasMessageEnd = text.includes('event: message_end');
    const hasBudget = text.includes('event: budget');
    const ok = hasDone && hasMessageEnd && hasBudget;
    if (ok) {
      pass += 1;
      console.log(`PASS  ${expect.padEnd(14)} ${mission}`);
    } else {
      fail += 1;
      console.log(`FAIL  ${expect.padEnd(14)} ${mission} — missing events (done=${hasDone}, message_end=${hasMessageEnd}, budget=${hasBudget})`);
    }
  } catch (e) {
    fail += 1;
    console.log(`FAIL  ${expect.padEnd(14)} ${mission} — ${e.message}`);
  } finally {
    server.close();
  }
}

console.log(`\n${pass}/${pass + fail} golden missions produced valid bounded results`);
process.exit(fail ? 1 : 0);
