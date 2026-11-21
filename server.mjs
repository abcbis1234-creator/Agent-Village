import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { AGENTS } from './lib/agents.mjs';
import { Store } from './lib/store.mjs';
import { runTool } from './lib/tools.mjs';
import { orchestrate } from './lib/orchestrator.mjs';
import { createMetrics } from './lib/metrics.mjs';
import { VectorMemory } from './lib/memory.mjs';
import { ApprovalQueue } from './lib/policy.mjs';
import { probeAllProviders, listProviders, defaultProvider } from './lib/llm.mjs';
import { signExport } from './lib/signature.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(join(HERE, 'public'));
const DATA_FILE = resolve(join(HERE, 'data', 'state.json'));

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

const MIME = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}));

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

/* ---------- helpers ---------- */
function send(res, status, body, extra = {}, head = false) {
  if (res.headersSent) return;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Length': buf.length, ...extra });
  head ? res.end() : res.end(buf);
}
function sendJson(res, status, data, head = false) {
  if (res.headersSent) return;
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' }, head);
}

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start > RATE_WINDOW_MS) { buckets.set(ip, { start: now, count: 1 }); return false; }
  b.count += 1;
  return b.count > RATE_MAX;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (now - b.start > RATE_WINDOW_MS) buckets.delete(ip);
}, RATE_WINDOW_MS).unref();

function checkToken(req, url) {
  const token = process.env.VILLAGE_API_TOKEN || '';
  if (!token) return true;
  const hdr = req.headers['authorization'];
  const given = hdr?.startsWith('Bearer ') ? hdr.slice(7) : url.searchParams.get('token');
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function userOf(req) { return String(req.headers['x-village-user'] ?? 'anon'); }

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
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' }, head);
  }
  let info;
  try { info = await stat(filePath); } catch { info = null; }
  if (!info || !info.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' }, head);
  const data = await readFile(filePath);
  const type = MIME.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
  send(res, 200, data, { 'Content-Type': type }, head);
}

/* ---------- app ---------- */

export function createApp({ store, metrics } = {}) {
  const _store = store ?? new Store(DATA_FILE);
  const _metrics = metrics ?? createMetrics();
  const _memory = new VectorMemory(_store);
  const _policy = new ApprovalQueue();
  const _aborts = new Map();
  const _mediaApprovals = new Map();
  const ctx = { store: _store, metrics: _metrics, memory: _memory, policy: _policy, aborts: _aborts, mediaApprovals: _mediaApprovals };

  const server = createServer(async (req, res) => {
    const head = req.method === 'HEAD';
    const t0 = Date.now();
    _metrics.inc('requests');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const ip = req.socket.remoteAddress ?? 'unknown';

      if (url.pathname.startsWith('/api/') && rateLimited(ip)) {
        return sendJson(res, 429, { error: 'Too Many Requests' }, head);
      }
      if (url.pathname.startsWith('/api/') && !checkToken(req, url)) {
        return sendJson(res, 401, { error: 'Unauthorized' }, head);
      }

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

  /* --- health & metrics --- */
  if (parts.length === 2 && parts[1] === 'health' && method === 'GET') {
    sendJson(res, 200, { ok: true }); return true;
  }
  if (parts.length === 2 && parts[1] === 'metrics' && method === 'GET') {
    sendJson(res, 200, ctx.metrics.snapshot()); return true;
  }

  /* --- providers (real LLM adapter status) --- */
  if (parts.length === 2 && parts[1] === 'providers' && method === 'GET') {
    sendJson(res, 200, { providers: listProviders(), default: defaultProvider() }); return true;
  }
  if (parts.length === 3 && parts[1] === 'providers' && parts[2] === 'health' && method === 'GET') {
    sendJson(res, 200, await probeAllProviders()); return true;
  }

  /* --- agents --- */
  if (parts.length === 2 && parts[1] === 'agents' && method === 'GET') {
    sendJson(res, 200, { agents: Object.values(AGENTS).map((a) => ({
      id: a.id, name: a.name, emoji: a.emoji, color: a.color, role: a.role,
    })) });
    return true;
  }
  if (parts.length === 2 && parts[1] === 'agent-contract' && method === 'GET') {
    sendJson(res, 200, {
      version: '2.0',
      project: 'agent-village',
      purpose: 'bounded multi-agent orchestration contract',
      endpoints: {
        capabilities: 'GET /api/capabilities',
        providers: 'GET /api/providers',
        providers_health: 'GET /api/providers/health',
        run: 'POST /api/run',
        run_stream: 'POST /api/conversations/:id/chat',
        cancel: 'POST /api/runs/:id/cancel',
        events: 'GET /api/runs/:id/events',
        export: 'GET /api/runs/:id/export',
        approvals: 'GET /api/approvals',
        approve: 'POST /api/approvals/:id',
        tools_approve: 'POST /api/tools/approve',
        media: 'POST /api/media/generate',
        media_approve: 'POST /api/media/approve',
        feedback: 'GET/POST /api/feedback',
        knowledge: 'GET/POST /api/knowledge',
      },
      run_input: { mission: 'string, max 1200 chars', capability: 'optional capability key or auto', rounds: 'optional integer 1-3' },
      return_shape: ['capability', 'deliverable', 'verdict'],
      contribution_policy: ['propose changes as structured deliverables or patches', 'never request or return browser-side secrets', 'require human review before publish or consequential external action'],
      collaboration: { preferred: 'canonical Git branch or reviewed pull request', alternative: 'server-side adapter that implements the same contract' },
    });
    return true;
  }

  /* --- capabilities (webnovel templates preserved) --- */
  if (parts.length === 2 && parts[1] === 'capabilities' && method === 'GET') {
    sendJson(res, 200, { capabilities: ctx.store.listCapabilities() }); return true;
  }
  if (parts.length === 2 && parts[1] === 'capabilities' && method === 'POST') {
    const body = await readJson(req);
    if (!body.id || !body.name) { sendJson(res, 422, { error: 'id and name required' }); return true; }
    const cap = await ctx.store.registerCapability(body);
    sendJson(res, 201, cap); return true;
  }

  /* --- conversations --- */
  if (parts.length === 2 && parts[1] === 'conversations') {
    if (method === 'GET') { sendJson(res, 200, { conversations: ctx.store.listConversations(user) }); return true; }
    if (method === 'POST') {
      const body = await readJson(req);
      const agentId = body.agentId ?? 'planner';
      if (!AGENTS[agentId]) { sendJson(res, 422, { error: 'unknown agentId' }); return true; }
      const c = await ctx.store.createConversation({ agentId, title: body.title, user, provider: body.provider });
      sendJson(res, 201, c); return true;
    }
  }
  if (parts.length === 3 && parts[1] === 'conversations' && method === 'GET') {
    const c = ctx.store.getConversation(parts[2]);
    if (!c) return sendJson(res, 404, { error: 'not found' });
    if (c.user !== user) return sendJson(res, 403, { error: 'forbidden' });
    sendJson(res, 200, c); return true;
  }
  /* --- /api/run backward-compat (main's primary endpoint) --- */
  if (parts.length === 2 && parts[1] === 'run' && method === 'POST') {
    await handleRun(req, res, ctx, user);
    return true;
  }

  /* --- chat (SSE) --- */
  if (parts.length === 4 && parts[1] === 'conversations' && parts[3] === 'chat' && method === 'POST') {
    await handleChat(req, res, parts[2], ctx, user);
    return true;
  }

  /* --- runs: cancel, events, export --- */
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'cancel' && method === 'POST') {
    const runId = parts[2];
    const ac = ctx.aborts.get(runId);
    if (!ac) return sendJson(res, 404, { error: 'run not tracked or already finished' });
    ctx.metrics.inc('cancels');
    ac.abort();
    sendJson(res, 200, { cancelled: true, runId }); return true;
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
    const events = ctx.store.listEvents(parts[2]);
    const signed = signExport({ run, conversation: conv, events });
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="run-${parts[2]}.json"`,
    });
    res.end(JSON.stringify(signed, null, 2));
    return true;
  }

  /* --- approvals --- */
  if (parts.length === 2 && parts[1] === 'approvals' && method === 'GET') {
    sendJson(res, 200, { pending: ctx.policy.list() }); return true;
  }
  if (parts.length === 3 && parts[1] === 'approvals' && method === 'POST') {
    const body = await readJson(req);
    ctx.metrics.inc('approvals');
    const ok = ctx.policy.decide(parts[2], body);
    sendJson(res, ok ? 200 : 404, { ok }); return true;
  }
  /* --- /api/tools/approve alias (main's primary endpoint) --- */
  if (parts.length === 3 && parts[1] === 'tools' && parts[2] === 'approve' && method === 'POST') {
    const body = await readJson(req);
    ctx.metrics.inc('approvals');
    const ok = ctx.policy.decide(body.id, body);
    sendJson(res, ok ? 200 : 404, { ok, id: body.id }); return true;
  }

  /* --- feedback (preserved — maps to memory layer) --- */
  if (parts.length === 2 && parts[1] === 'feedback' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || !body.text.trim()) { sendJson(res, 422, { error: 'text required' }); return true; }
    const m = await ctx.memory.add(`[feedback] ${body.text.trim()}`, body.tags ?? [], user);
    sendJson(res, 201, m); return true;
  }
  if (parts.length === 2 && parts[1] === 'feedback' && method === 'GET') {
    sendJson(res, 200, { feedback: ctx.memory.search('feedback', { k: 50, user }) }); return true;
  }

  /* --- knowledge (preserved — vector-backed) --- */
  if (parts.length === 2 && parts[1] === 'knowledge' && method === 'GET') {
    const q = url.searchParams.get('q') ?? '';
    if (!q) return sendJson(res, 200, { all: ctx.store.listMemories(user) });
    sendJson(res, 200, { results: ctx.memory.search(q, { k: 10, user }) }); return true;
  }
  if (parts.length === 2 && parts[1] === 'knowledge' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || !body.text.trim()) { sendJson(res, 422, { error: 'text required' }); return true; }
    const m = await ctx.memory.add(body.text.trim(), body.tags ?? [], user);
    sendJson(res, 201, m); return true;
  }

  /* --- media (Stable Diffusion, approval-gated) --- */
  if (parts.length === 3 && parts[1] === 'media' && parts[2] === 'generate' && method === 'POST') {
    const body = await readJson(req);
    const kind = body.kind;
    const prompt = body.prompt;
    if (!kind || !prompt || typeof prompt !== 'string') { sendJson(res, 400, { error: 'kind and prompt required' }); return true; }
    if (kind !== 'image') { sendJson(res, 400, { error: 'unsupported media kind' }); return true; }
    if (!body.approved) {
      const id = `media-${crypto.randomUUID()}`;
      ctx.mediaApprovals.set(id, { approved: false, kind, prompt, user, createdAt: Date.now() });
      sendJson(res, 202, { error: 'approval required', id, kind, prompt, note: 'Call POST /api/tools/approve with this id, then retry with approved: true.' });
      return true;
    }
    const entry = ctx.mediaApprovals.get(body.id);
    if (!entry || !entry.approved || entry.kind !== kind || entry.prompt !== prompt) {
      sendJson(res, 403, { error: 'no valid approval for this generation' }); return true;
    }
    try {
      const result = await runTool('sd_generate', { prompt: entry.prompt, width: body.width || 512, height: body.height || 512 }, { memory: ctx.memory, store: ctx.store, user });
      entry.approved = false;
      sendJson(res, 200, result); return true;
    } catch (err) {
      sendJson(res, 400, { error: err.message || 'generation failed' }); return true;
    }
  }
  if (parts.length === 3 && parts[1] === 'media' && parts[2] === 'approve' && method === 'POST') {
    const body = await readJson(req);
    const entry = ctx.mediaApprovals.get(body.id);
    if (!entry) { sendJson(res, 404, { error: 'unknown media approval id' }); return true; }
    entry.approved = true;
    ctx.metrics.inc('approvals');
    sendJson(res, 200, { approved: true, id: body.id, kind: entry.kind, prompt: entry.prompt }); return true;
  }

  sendJson(res, 404, { error: 'not found' });
  return true;
}

async function handleChat(req, res, conversationId, ctx, user) {
  const conversation = ctx.store.getConversation(conversationId);
  if (!conversation) return sendJson(res, 404, { error: 'conversation not found' });
  if (conversation.user !== user) return sendJson(res, 403, { error: 'forbidden' });

  const body = await readJson(req);
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return sendJson(res, 422, { error: 'message required' });
  }

  ctx.metrics.inc('chats');
  await ctx.store.appendMessage(conversationId, { role: 'user', content: body.message });

  const provider = body.provider ?? conversation.provider ?? defaultProvider();
  const run = ctx.store.createRun({ conversationId, provider, user });
  const ac = new AbortController();
  ctx.aborts.set(run.id, ac);

  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Run-Id': run.id,
  });

  let closed = false;
  req.on('close', () => { closed = true; });
  const emit = (event, data) => {
    if (closed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; }
  };
  emit('run_id', { runId: run.id });

  try {
    for await (const evt of orchestrate({
      message: body.message,
      provider,
      user,
      store: ctx.store,
      memory: ctx.memory,
      policy: ctx.policy,
      conversationId,
      runId: run.id,
      signal: ac.signal,
      onEvent: () => {},
    })) {
      emit(evt.type, evt);
      if (evt.type === 'message_end') {
        await ctx.store.appendMessage(conversationId, { role: 'agent', agentId: evt.agentId, content: evt.content });
      }
    }
    await ctx.store.finishRun(run.id, { status: 'ok' });
  } catch (err) {
    if (err.name === 'AbortError') {
      await ctx.store.finishRun(run.id, { status: 'cancelled' });
      emit('cancelled', { runId: run.id });
    } else {
      console.error('[chat]', err);
      await ctx.store.finishRun(run.id, { status: 'error', error: err.message });
      emit('error', { message: err.message });
    }
  } finally {
    ctx.aborts.delete(run.id);
    if (!closed) { try { res.end(); } catch {} }
  }
}

async function handleRun(req, res, ctx, user) {
  const body = await readJson(req);
  const mission = body.mission;
  if (typeof mission !== 'string' || !mission.trim()) {
    return sendJson(res, 422, { error: 'mission required' });
  }
  const capability = body.capability ?? 'auto';
  const rounds = Math.max(1, Math.min(3, Number.isInteger(body.rounds) ? body.rounds : 2));
  const agentId = AGENTS[capability] ? capability : 'planner';
  const conversation = await ctx.store.createConversation({ agentId, title: mission.slice(0, 60), user, provider: body.provider });
  ctx.metrics.inc('chats');
  await ctx.store.appendMessage(conversation.id, { role: 'user', content: mission });

  const provider = body.provider ?? defaultProvider();
  const run = ctx.store.createRun({ conversationId: conversation.id, provider, user });
  const ac = new AbortController();
  ctx.aborts.set(run.id, ac);

  const head = req.method === 'HEAD';
  if (body.stream) {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Run-Id': run.id });
    let closed = false;
    req.on('close', () => { closed = true; });
    const emit = (event, data) => { if (closed) return; try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { closed = true; } };
    emit('run_id', { runId: run.id });
    try {
      for await (const evt of orchestrate({
        message: mission, provider, user, store: ctx.store, memory: ctx.memory, policy: ctx.policy,
        conversationId: conversation.id, runId: run.id, signal: ac.signal, onEvent: () => {},
      })) {
        emit(evt.type, evt);
        if (evt.type === 'message_end') await ctx.store.appendMessage(conversation.id, { role: 'agent', agentId: evt.agentId, content: evt.content });
      }
      await ctx.store.finishRun(run.id, { status: 'ok' });
    } catch (err) {
      if (err.name === 'AbortError') {
        await ctx.store.finishRun(run.id, { status: 'cancelled' });
        emit('cancelled', { runId: run.id });
      } else {
        console.error('[run]', err);
        await ctx.store.finishRun(run.id, { status: 'error', error: err.message });
        emit('error', { message: err.message });
      }
    } finally {
      ctx.aborts.delete(run.id);
      if (!closed) { try { res.end(); } catch {} }
    }
    return;
  }

  let finalText = '';
  try {
    for await (const evt of orchestrate({
      message: mission, provider, user, store: ctx.store, memory: ctx.memory, policy: ctx.policy,
      conversationId: conversation.id, runId: run.id, signal: ac.signal, onEvent: () => {},
    })) {
      if (evt.type === 'message_end') finalText = evt.content;
    }
    await ctx.store.finishRun(run.id, { status: 'ok' });
    sendJson(res, 200, {
      id: run.id, mission, rounds, source: 'MANAGED LOCAL DEMO',
      capability: { key: capability, name: AGENTS[agentId]?.name ?? agentId },
      deliverable: { type: 'brief', title: mission, sections: [{ name: 'Result', content: finalText }] },
      verdict: { decision: finalText || 'No result produced.' },
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      await ctx.store.finishRun(run.id, { status: 'cancelled' });
      return sendJson(res, 499, { error: 'request cancelled', runId: run.id });
    }
    console.error('[run]', err);
    await ctx.store.finishRun(run.id, { status: 'error', error: err.message });
    return sendJson(res, 400, { error: err.message || 'request failed' });
  } finally {
    ctx.aborts.delete(run.id);
  }
}

/* ---------- entrypoint ---------- */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, store } = createApp();
  await store.load();
  server.listen(PORT, HOST, () => console.log(`Agent Village v3 listening on http://${HOST}:${PORT}`));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
