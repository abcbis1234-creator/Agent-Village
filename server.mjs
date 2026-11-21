import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { publicAgents } from './lib/agents.mjs';
import { Store } from './lib/store.mjs';
import { orchestrate } from './lib/orchestrator.mjs';
import { createMetrics } from './lib/metrics.mjs';
import { VectorMemory } from './lib/memory.mjs';
import { Archivist } from './lib/archivist.mjs';
import { probeAllProviders, listProviders, defaultProvider } from './lib/llm.mjs';
import { signExport } from './lib/signature.mjs';
import { SecurityReviewer } from './lib/security.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(join(HERE, 'public'));
const DATA_FILE = resolve(join(HERE, 'data', 'state.json'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const API_TOKEN = process.env.VILLAGE_API_TOKEN;
const REQUIRE_TOKEN = Boolean(API_TOKEN);

const MIME = new Map(Object.entries({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }));

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function send(res, status, body, extra = {}, head = false) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Length': buf.length, ...extra });
  head ? res.end() : res.end(buf);
}
function sendJson(res, status, data, head = false) { send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' }, head); }

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start > RATE_WINDOW_MS) { buckets.set(ip, { start: now, count: 1 }); return false; }
  b.count += 1;
  return b.count > RATE_MAX;
}
setInterval(() => { const now = Date.now(); for (const [ip, b] of buckets) if (now - b.start > RATE_WINDOW_MS) buckets.delete(ip); }, RATE_WINDOW_MS).unref();

function checkToken(req, url) {
  if (!REQUIRE_TOKEN) return true;
  const hdr = req.headers['authorization'];
  const given = hdr?.startsWith('Bearer ') ? hdr.slice(7) : url.searchParams.get('token');
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
const userOf = (req) => String(req.headers['x-village-user'] ?? 'anon');

async function readJson(req, limit = MAX_BODY) {
  const type = (req.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/json')) { const e = new Error('Unsupported Media Type'); e.status = 415; throw e; }
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) { const e = new Error('Payload Too Large'); e.status = 413; throw e; }
    chunks.push(c);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
}

async function serveStatic(req, res, pathname) {
  const head = req.method === 'HEAD';
  let rel;
  try { rel = decodeURIComponent(pathname); }
  catch { return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' }, head); }
  if (rel.includes('\0')) return send(res, 400, 'Bad Request', { 'Content-Type': 'text/plain; charset=utf-8' }, head);
  const relPath = rel === '/' ? '/index.html' : rel;
  const safe = normalize(relPath).replace(/^([/\\]|\.\.[/\\])+/, '');
  const filePath = resolve(join(PUBLIC_DIR, safe));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' }, head);
  let info;
  try { info = await stat(filePath); } catch { info = null; }
  if (!info || !info.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' }, head);
  const data = await readFile(filePath);
  const type = MIME.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
  send(res, 200, data, { 'Content-Type': type }, head);
}

export function createApp({ store, metrics } = {}) {
  const _store = store ?? new Store(DATA_FILE);
  const _metrics = metrics ?? createMetrics();
  const _memory = new VectorMemory(_store);
  const _aborts = new Map();
  const _archivist = new Archivist(_store);
  const _security = new SecurityReviewer({ store: _store });
  const ctx = { store: _store, metrics: _metrics, memory: _memory, aborts: _aborts, archivist: _archivist, security: _security };

  const server = createServer(async (req, res) => {
    const head = req.method === 'HEAD';
    const t0 = Date.now();
    _metrics.inc('requests');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const ip = req.socket.remoteAddress ?? 'unknown';
      if (url.pathname.startsWith('/api/') && rateLimited(ip)) return sendJson(res, 429, { error: 'Too Many Requests' }, head);
      if (url.pathname.startsWith('/api/') && !checkToken(req, url)) return sendJson(res, 401, { error: 'Unauthorized' }, head);
      const handled = await route(req, res, url, ctx);
      if (handled) { _metrics.observeLatency(Date.now() - t0); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method Not Allowed' }, head);
      await serveStatic(req, res, url.pathname);
      _metrics.observeLatency(Date.now() - t0);
    } catch (err) {
      _metrics.inc('errors');
      const status = Number.isInteger(err?.status) ? err.status : 500;
      if (status >= 500) console.error('[server]', err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Internal Server Error' : err.message });
      else res.destroy();
    }
  });

  return { server, store: _store, metrics: _metrics, ctx };
}

async function route(req, res, url, ctx) {
  const method = req.method;
  const parts = url.pathname.split('/').filter(Boolean);
  const user = userOf(req);
  if (parts[0] !== 'api') return false;

  if (parts.length === 2 && parts[1] === 'health' && method === 'GET') { sendJson(res, 200, { ok: true }); return true; }
  if (parts.length === 2 && parts[1] === 'metrics' && method === 'GET') { sendJson(res, 200, ctx.metrics.snapshot()); return true; }
  if (parts.length === 2 && parts[1] === 'providers' && method === 'GET') { sendJson(res, 200, { providers: listProviders(), default: defaultProvider() }); return true; }
  if (parts.length === 3 && parts[1] === 'providers' && parts[2] === 'health' && method === 'GET') { sendJson(res, 200, await probeAllProviders()); return true; }
  if (parts.length === 2 && parts[1] === 'agents' && method === 'GET') { sendJson(res, 200, { agents: publicAgents() }); return true; }

  if (parts.length === 2 && parts[1] === 'conversations') {
    if (method === 'GET') { sendJson(res, 200, { conversations: ctx.store.listConversations(user) }); return true; }
    if (method === 'POST') {
      const body = await readJson(req);
      const c = await ctx.store.createConversation({ agentId: body.agentId ?? 'planner', title: body.title, user, provider: body.provider });
      sendJson(res, 201, c); return true;
    }
  }
  if (parts.length === 3 && parts[1] === 'conversations' && method === 'GET') {
    const c = ctx.store.getConversation(parts[2]);
    if (!c) return sendJson(res, 404, { error: 'not found' });
    if (c.user !== user) return sendJson(res, 403, { error: 'forbidden' });
    sendJson(res, 200, c); return true;
  }
  if (parts.length === 4 && parts[1] === 'conversations' && parts[3] === 'chat' && method === 'POST') {
    await handleChat(req, res, parts[2], ctx, user); return true;
  }

  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'cancel' && method === 'POST') {
    const ac = ctx.aborts.get(parts[2]);
    if (!ac) return sendJson(res, 404, { error: 'not tracked' });
    ctx.metrics.inc('cancels');
    ac.abort();
    sendJson(res, 200, { cancelled: true }); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'events' && method === 'GET') {
    const run = ctx.store.getRun(parts[2]);
    if (!run) return sendJson(res, 404, { error: 'not found' });
    sendJson(res, 200, { run, events: ctx.store.listEvents(parts[2]) }); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'export' && method === 'GET') {
    const run = ctx.store.getRun(parts[2]);
    if (!run) return sendJson(res, 404, { error: 'not found' });
    const conv = ctx.store.getConversation(run.conversationId);
    const signed = signExport({ run, conversation: conv, events: ctx.store.listEvents(parts[2]) });
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="run-${parts[2]}.json"` });
    res.end(JSON.stringify(signed, null, 2));
    return true;
  }

  if (parts.length === 3 && parts[1] === 'memory' && parts[2] === 'retrieve' && method === 'GET') {
    const archivist = new Archivist(ctx.store);
    const q = url.searchParams.get('q') ?? '';
    const results = archivist.retrieve(q, { user });
    sendJson(res, 200, { results: results.map((r) => ({ id: r.memory.id, type: r.memory.type ?? 'episodic', text: r.memory.text, score: Number(r.score.toFixed(3)), relevance: Number(r.relevance.toFixed(3)), recency: Number(r.recency.toFixed(3)), importance: r.memory.importance, provenance: r.memory.provenance ?? [] })) });
    return true;
  }
  if (parts.length === 3 && parts[1] === 'memory' && parts[2] === 'consolidate' && method === 'POST') {
    const archivist = new Archivist(ctx.store);
    sendJson(res, 200, await archivist.consolidate({ user }));
    return true;
  }

  if (parts.length === 2 && parts[1] === 'knowledge') {
    if (method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      if (!q) return sendJson(res, 200, { all: ctx.store.listMemories(user) });
      sendJson(res, 200, { results: ctx.memory.search(q, { k: 10, user }) }); return true;
    }
    if (method === 'POST') {
      const body = await readJson(req);
      if (typeof body.text !== 'string' || !body.text.trim()) return sendJson(res, 422, { error: 'text required' });
      const m = await ctx.memory.add(body.text.trim(), body.tags ?? [], user);
      sendJson(res, 201, m); return true;
    }
  }

  if (parts.length === 2 && parts[1] === 'feedback' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || !body.text.trim()) return sendJson(res, 422, { error: 'text required' });
    const m = await ctx.memory.add(`[feedback] ${body.text.trim()}`, body.tags ?? [], user);
    sendJson(res, 201, m); return true;
  }

  sendJson(res, 404, { error: 'not found' });
  return true;
}

async function handleChat(req, res, conversationId, ctx, user) {
  const conversation = ctx.store.getConversation(conversationId);
  if (!conversation) return sendJson(res, 404, { error: 'conversation not found' });
  if (conversation.user !== user) return sendJson(res, 403, { error: 'forbidden' });

  const body = await readJson(req);
  if (typeof body.message !== 'string' || !body.message.trim()) return sendJson(res, 422, { error: 'message required' });

  ctx.metrics.inc('chats');
  await ctx.store.appendMessage(conversationId, { role: 'user', content: body.message });

  const provider = body.provider ?? conversation.provider ?? defaultProvider();
  const run = ctx.store.createRun({ conversationId, provider, user });
  const ac = new AbortController();
  ctx.aborts.set(run.id, ac);

  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Run-Id': run.id });

  let closed = false;
  req.on('close', () => { closed = true; });
  const emit = (event, data) => {
    if (closed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; }
  };
  emit('run_id', { runId: run.id });

  try {
    for await (const evt of orchestrate({ message: body.message, provider, user, store: ctx.store, conversationId, runId: run.id, signal: ac.signal })) {
      emit(evt.type, evt);
      if (evt.type === 'security_decision' && (evt.decision.verdict === 'deny')) ctx.metrics.inc('securityDenials');
      if (evt.type === 'critique' && evt.verdict.overall === 'reject') ctx.metrics.inc('criticRejects');
      if (evt.type === 'message_end') await ctx.store.appendMessage(conversationId, { role: 'agent', agentId: evt.agentId, content: evt.content });
    }
    await ctx.store.finishRun(run.id, { status: 'ok' });
  } catch (err) {
    if (err.name === 'AbortError') { await ctx.store.finishRun(run.id, { status: 'cancelled' }); emit('cancelled', { runId: run.id }); }
    else { console.error('[chat]', err); await ctx.store.finishRun(run.id, { status: 'error', error: err.message }); emit('error', { message: err.message }); }
  } finally {
    ctx.aborts.delete(run.id);
    if (!closed) { try { res.end(); } catch {} }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, store } = createApp();
  await store.load();
  server.listen(PORT, HOST, () => console.log(`Agent Village v3 listening on http://${HOST}:${PORT}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}