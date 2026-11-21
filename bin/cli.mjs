#!/usr/bin/env node
import readline from 'node:readline/promises';

const BASE = process.env.AGENT_VILLAGE_URL ?? 'http://127.0.0.1:3000';
const TOKEN = process.env.VILLAGE_API_TOKEN;
const USER = process.env.VILLAGE_USER ?? 'anon';

function authHeaders(extra = {}) {
  const h = { 'X-Village-User': USER, ...extra };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

async function* sseLines(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
      }
      if (data.length) {
        try { yield { event, data: JSON.parse(data.join('\n')) }; }
        catch { yield { event, data: data.join('\n') }; }
      }
    }
  }
}

const create = await fetch(`${BASE}/api/conversations`, {
  method: 'POST',
  headers: authHeaders({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({ agentId: 'planner' }),
});
if (!create.ok) {
  console.error(`Could not create conversation (${create.status}). Is the server running?`);
  process.exit(1);
}
const convo = await create.json();
console.log(`Conversation ${convo.id.slice(0, 8)} — type "exit" to quit.\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

while (true) {
  const message = await rl.question('you> ');
  if (message.trim() === 'exit') break;
  if (!message.trim()) continue;

  const res = await fetch(`${BASE}/api/conversations/${convo.id}/chat`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) { console.error(`HTTP ${res.status}`); continue; }

  for await (const { event, data } of sseLines(res)) {
    if (event === 'phase') process.stdout.write(`\x1b[2m[${data.phase}]\x1b[0m\n`);
    else if (event === 'tool_call') process.stdout.write(`  \x1b[33m⚙ ${data.tool}(${JSON.stringify(data.args ?? {})})\x1b[0m\n`);
    else if (event === 'tool_result') process.stdout.write(`  \x1b[32m→ ${data.result}\x1b[0m\n`);
    else if (event === 'tool_error') process.stdout.write(`  \x1b[31m✗ ${data.error}\x1b[0m\n`);
    else if (event === 'message_start') process.stdout.write(`\x1b[35m${data.agentId}>\x1b[0m `);
    else if (event === 'chunk') process.stdout.write(data.content);
    else if (event === 'message_end') process.stdout.write('\n');
    else if (event === 'error') process.stderr.write(`\n[error] ${data.message}\n`);
    else if (event === 'cancelled') console.log(`\n[run cancelled]`);
  }
  console.log();
}
rl.close();
