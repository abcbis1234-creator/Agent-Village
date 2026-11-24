#!/usr/bin/env node
// bin/admin.mjs — offline store administration (#78 seed, #94 backup/restore).
//
// Usage:
//   node bin/admin.mjs seed    [path]   Populate a store with deterministic demo data
//   node bin/admin.mjs backup  [path]   Copy state.json -> state.json.<ts>.bak
//   node bin/admin.mjs restore [path] [file]  Restore a backup (backs up current first)
//   node bin/admin.mjs verify  [path]   Verify audit hash chain + integrity
//
// Default path: data/state.json (relative to repo root).

import { copyFile, access, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_PATH = resolve(join(HERE, '..', 'data', 'state.json'));

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function loadStore(path) {
  const s = new Store(path);
  await s.load();
  return s;
}

async function cmdSeed(path) {
  const s = await loadStore(path);
  // Deterministic demo data (no randomness) so seeds are reproducible.
  const convo = await s.createConversation({ agentId: 'planner', title: 'Demo: coffee run', user: 'demo' });
  await s.appendMessage(convo.id, { role: 'user', content: 'Find a coffee shop near me and summarize the top result.' });
  await s.appendMessage(convo.id, { role: 'agent', agentId: 'reviewer', content: 'Here is a plan: locate nearby cafes, rank by rating, summarize the best.' });

  const run = s.createRun({ conversationId: convo.id, provider: 'mock', user: 'demo' });
  s.appendEvent(run.id, { type: 'phase', phase: 'recall', agentId: 'archivist' });
  s.appendEvent(run.id, { type: 'phase', phase: 'scout', agentId: 'scout' });
  s.appendEvent(run.id, { type: 'scout_report', intent: 'local-search', domain: 'food', ambiguities: [], suggestedTools: [] });
  await s.finishRun(run.id, { status: 'ok' });

  s.data.memories.push({ id: 'seed-mem-1', type: 'semantic', text: 'The demo user prefers espresso over drip coffee.', importance: 4, user: 'demo', provenance: [], confidence: 1, createdAt: Date.now(), vec: [], accessCount: 0, supersededBy: null });
  s.data.wants.push({ id: 'seed-want-1', text: 'find a coffee shop', author: 'demo', tags: ['food'], reward: 0, user: 'demo', status: 'open', createdAt: Date.now(), updatedAt: Date.now(), claimedBy: null, fulfilledBy: null, result: null });

  await s.writeAudit({ verdict: 'allow', tool: 'clock', user: 'demo', runId: run.id });
  await s.writeAudit({ verdict: 'allow_logged', tool: 'recall', user: 'demo', runId: run.id });
  await s.save();
  console.log(`Seeded ${path}`);
  console.log(`  conversations: ${s.listConversations('demo').length}`);
  console.log(`  memories: ${s.data.memories.length}`);
  console.log(`  wants: ${s.data.wants.length}`);
  console.log(`  audit records: ${s.data.audit.length}`);
}

async function cmdBackup(path) {
  if (!(await exists(path))) { console.error(`No store at ${path}`); process.exit(1); }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${path}.${ts}.bak`;
  await copyFile(path, dest);
  const info = await stat(dest);
  console.log(`Backed up ${path} -> ${dest} (${info.size} bytes)`);
}

async function cmdRestore(path, file) {
  if (!file) {
    // Pick the most recent .bak if none given.
    const dir = join(path, '..');
    const base = path.split('/').pop();
    const files = (await readdir(dir)).filter((f) => f.startsWith(`${base}.`) && f.endsWith('.bak')).sort();
    file = files.length ? join(dir, files[files.length - 1]) : null;
    if (!file) { console.error('No backup file found and none specified'); process.exit(1); }
  }
  if (!(await exists(file))) { console.error(`Backup not found: ${file}`); process.exit(1); }
  // Safety: back up the current store before overwriting.
  if (await exists(path)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(path, `${path}.pre-restore.${ts}.bak`);
  }
  await copyFile(file, path);
  // Validate the restored store loads and its audit chain verifies.
  const s = await loadStore(path);
  const v = s.verifyAuditChain();
  console.log(`Restored ${path} from ${file}`);
  console.log(`  audit chain: ${v.ok ? `ok (${v.count} records)` : `BROKEN at ${v.brokenAt} (${v.reason})`}`);
}

async function cmdVerify(path) {
  const s = await loadStore(path);
  const v = s.verifyAuditChain();
  const problems = [];
  if (!v.ok) problems.push(`audit chain broken at ${v.brokenAt}: ${v.reason}`);
  for (const [id, run] of Object.entries(s.data.runs)) {
    if (!s.data.events[id]) problems.push(`run ${id} has no events array`);
  }
  if (problems.length) {
    console.error('Integrity problems:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`OK: ${path}`);
  console.log(`  schema version: ${s.version}`);
  console.log(`  audit chain: ${v.count} records, verified`);
  console.log(`  runs: ${Object.keys(s.data.runs).length}, conversations: ${Object.keys(s.data.conversations).length}, memories: ${s.data.memories.length}`);
}

const [cmd, ...args] = process.argv.slice(2);
const path = args[0] ? resolve(args[0]) : DEFAULT_PATH;
try {
  if (cmd === 'seed') await cmdSeed(path);
  else if (cmd === 'backup') await cmdBackup(path);
  else if (cmd === 'restore') await cmdRestore(path, args[1]);
  else if (cmd === 'verify') await cmdVerify(path);
  else {
    console.log('Usage: node bin/admin.mjs <seed|backup|restore|verify> [store-path] [backup-file]');
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`admin error: ${e.message}`);
  process.exit(1);
}