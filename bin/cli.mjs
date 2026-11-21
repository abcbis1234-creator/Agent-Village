#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const BASE = process.env.AGENT_VILLAGE_URL ?? 'http://127.0.0.1:3000';
const TOKEN = process.env.VILLAGE_API_TOKEN;
const USER = process.env.VILLAGE_USER ?? 'anon';
const auth = (extra = {}) => { const h = { 'X-Village-User': USER, ...extra }; if (TOKEN) h.Authorization = `Bearer ${TOKEN}`; return h; };

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
      for (const line of raw.split('\n')) { if (line.startsWith('event: ')) event = line.slice(7); else if (line.startsWith('data: ')) data.push(line.slice(6)); }
      if (data.length) { try { yield { event, data: JSON.parse(data.join('\n')) }; } catch { yield { event, data: data.join('\n') }; } }
    }
  }
}

const create = await fetch(`${BASE}/api/conversations`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ agentId: 'planner' }) });
if (!create.ok) { console.error(`Could not create conversation (${create.status}). Is the server running?`); process.exit(1); }
const convo = await create.json();
console.log(`Conversation ${convo.id.slice(0, 8)}. Type "exit" to quit.\n`);

const rl = readline.createInterface({ input, output });
while (true) {
  const message = await rl.question('you> ');
  if (message.trim() === 'exit') break;
  if (!message.trim()) continue;
  const res = await fetch(`${BASE}/api/conversations/${convo.id}/chat`, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ message }) });
  if (!res.ok) { console.error(`HTTP ${res.status}`); continue; }
  for await (const { event, data } of sseLines(res)) {
    if (event === 'phase') process.stdout.write(`\x1b[2m[${data.phase}]\x1b[0m\n`);
    else if (event === 'memory_packet' && data.packet.length) process.stdout.write(`\x1b[2m  recalled ${data.packet.length}\x1b[0m\n`);
    else if (event === 'scout_report') process.stdout.write(`\x1b[2m  scout: ${data.intent} (${data.domain})\x1b[0m\n`);
    else if (event === 'planner_raw') process.stdout.write(`\x1b[2m  plan: ${data.steps.map((s) => s.tool).join(', ') || 'none'}\x1b[0m\n`);
    else if (event === 'security_decision') { const v = data.decision.verdict; const c = v === 'deny' ? 31 : v === 'require_approval' ? 33 : 32; process.stdout.write(`  \x1b[${c}m🔒 ${data.decision.tool}: ${v}\x1b[0m\n`); }
    else if (event === 'tool_result') process.stdout.write(`  \x1b[32m→ ${data.tool}: ${String(data.result).slice(0, 120)}\x1b[0m\n`);
    else if (event === 'tool_error') process.stdout.write(`  \x1b[31m✗ ${data.tool}: ${data.error}\x1b[0m\n`);
    else if (event === 'verification' && data.findings.length) process.stdout.write(`  \x1b[33m🛡️ ${data.severity}: ${data.findings.map((f) => f.kind).join(',')}\x1b[0m\n`);
    else if (event === 'message_start') process.stdout.write(`\x1b[35m${data.agentId}>\x1b[0m `);
    else if (event === 'chunk') process.stdout.write(data.content);
    else if (event === 'message_end') process.stdout.write('\n');
    else if (event === 'critique') process.stdout.write(`\x1b[2m  critic: ${data.verdict.overall} (${data.verdict.calibrated})\x1b[0m\n`);
    else if (event === 'budget') process.stdout.write(`\x1b[2m  budget: ${data.snapshot.used.tokens} tok, ${data.snapshot.elapsedMs}ms\x1b[0m\n`);
    else if (event === 'error') process.stderr.write(`\n[error ${data.where ?? ''}] ${data.message}\n`);
  }
  console.log();
}
rl.close();