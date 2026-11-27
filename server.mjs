import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';

import { publicAgents } from './lib/agents.mjs';
import { Store, recoverInterruptedRuns } from './lib/store.mjs';
import { orchestrate } from './lib/orchestrator.mjs';
import { createMetrics } from './lib/metrics.mjs';
import { VectorMemory } from './lib/memory.mjs';
import { Archivist } from './lib/archivist.mjs';
import { probeAllProviders, listProviders, defaultProvider, providerHealth, chatStream, chatStreamWithFallback, providerChain } from './lib/llm.mjs';
import { signExport } from './lib/signature.mjs';
import { SecurityReviewer } from './lib/security.mjs';
import { WantBoard } from './lib/wants.mjs';
import { GodMode } from './lib/godmode.mjs';
import { Chronicle } from './lib/chronicle.mjs';
import { Town } from './lib/town.mjs';
import { redact, redactError } from './lib/redact.mjs';
import { planProject, exportProject, buildExports, FORMATS, PLATFORMS, ASPECTS, TONE_NAMES, PACE_NAMES, FPS_VALUES } from './lib/director.mjs';
import { route as routeModel, listAvailableModels } from './lib/routing/free-first.mjs';
import { classifyFailure } from './lib/failures.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(join(HERE, 'public'));
const DATA_FILE = resolve(join(HERE, 'data', 'state.json'));
const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const MAX_MESSAGE = 20_000;
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
  return true;
}
function sendJson(res, status, data, head = false) { send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' }, head); }
function sendProblem(res, status, problem, head = false) {
  return send(res, status, JSON.stringify(problem), { 'Content-Type': 'application/problem+json; charset=utf-8' }, head);
}

// SSE schema version (#75). Bump when the event contract changes.
const SSE_SCHEMA_VERSION = 1;

// Backpressure (#7): cap concurrent runs and SSE clients. Excess is shed with
// 503 + Retry-After rather than piling up.
const MAX_ACTIVE_RUNS = 32;

// Stable, machine-readable error codes (#77). Clients branch on `code`, not the
// human `error` string. Unknown statuses fall back to the status-derived code.
const ERROR_CODES = {
  400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED', 408: 'TIMEOUT', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE', 422: 'UNPROCESSABLE', 429: 'RATE_LIMITED',
  503: 'UNAVAILABLE', 500: 'INTERNAL',
};
const ERROR_TITLES = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 422: 'Unprocessable Content', 429: 'Too Many Requests',
  500: 'Internal Server Error', 503: 'Service Unavailable',
};
// RFC 9457 problem details. `error` and `code` are kept as extension members
// for existing clients; new clients should branch on `code` / `status`.
function sendError(res, status, message, hint = undefined, head = false) {
  const problem = {
    type: 'about:blank',
    title: ERROR_TITLES[status] ?? `HTTP ${status}`,
    status,
    detail: message,
    code: ERROR_CODES[status] ?? `HTTP_${status}`,
    error: message,
  };
  if (hint) problem.hint = hint;
  if (typeof res.problemInstance === 'string') problem.instance = res.problemInstance;
  return sendProblem(res, status, problem, head);
}

// Idempotency (#8): dedupe side-effecting requests by client-supplied key.
// A repeated Idempotency-Key returns the stored response instead of re-running.
// Keys are scoped by user and route: two users (or two endpoints) that happen
// to pick the same key must not see each other's cached response.
const idempotency = new Map(); // scoped key -> { status, body, ts }
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
function idempotencyKey(req, user, scope) {
  const raw = req.headers['idempotency-key'];
  return typeof raw === 'string' && raw.length ? `${user}:${scope}:${raw}` : null;
}
function idempotencyGet(key) {
  const e = idempotency.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > IDEMPOTENCY_TTL_MS) { idempotency.delete(key); return null; }
  return e;
}
function idempotencySet(key, status, body) { idempotency.set(key, { status, body, ts: Date.now() }); }
setInterval(() => { const now = Date.now(); for (const [k, e] of idempotency) if (now - e.ts > IDEMPOTENCY_TTL_MS) idempotency.delete(k); }, IDEMPOTENCY_TTL_MS).unref();

const buckets = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.start > RATE_WINDOW_MS) { buckets.set(ip, { start: now, count: 1 }); return false; }
  b.count += 1;
  return b.count > RATE_MAX;
}
setInterval(() => { const now = Date.now(); for (const [ip, b] of buckets) if (now - b.start > RATE_WINDOW_MS) buckets.delete(ip); }, RATE_WINDOW_MS).unref();

function checkToken(req) {
  if (!REQUIRE_TOKEN) return true;
  // Header-only: a `?token=` fallback leaks the credential into access logs,
  // browser history, Referer headers, and any proxy in between.
  const hdr = req.headers['authorization'];
  const given = hdr?.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(API_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
const userOf = (req) => String(req.headers['x-village-user'] ?? 'anon');
const ownerOf = (record) => record?.user ?? 'anon';

// Look up a run and enforce ownership in one place. Run IDs are unguessable,
// but a leaked ID must not become a cross-user read/cancel capability.
function ownedRun(ctx, runId, user) {
  const run = ctx.store.getRun(runId);
  if (!run) return { error: [404, 'run not found'] };
  if (ownerOf(run) !== user) return { error: [403, 'forbidden'] };
  return { run };
}

async function readJson(req, limit = MAX_BODY) {
  // Accept application/json and structured-syntax suffixes such as
  // application/merge-patch+json; reject anything else (including jsonp).
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const isJson = type === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(type);
  if (!isJson) { const e = new Error('Unsupported Media Type'); e.status = 415; throw e; }
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) { const e = new Error('Payload Too Large'); e.status = 413; throw e; }
    chunks.push(c);
  }
  if (size === 0) return {};
  let parsed;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('Invalid JSON'); e.status = 400; throw e; }
  // Every route treats the body as an object. Rejecting null/arrays/primitives
  // here avoids TypeError-driven 500s such as `null.message`.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const e = new Error('JSON body must be an object'); e.status = 400; throw e;
  }
  return parsed;
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
  const _security = new SecurityReviewer({ store: _store, provider: defaultProvider(), llm: { chatStream, chatStreamWithFallback, providerChain } });
  const _wants = new WantBoard(_store);
  const _god = new GodMode(_store);
  const _chronicle = new Chronicle(_store);
  const _town = new Town(_store);
  const ctx = { store: _store, metrics: _metrics, memory: _memory, aborts: _aborts, archivist: _archivist, security: _security, wants: _wants, god: _god, chronicle: _chronicle, town: _town, draining: false, writers: new Map() };

  // Graceful drain (#4): stop accepting new runs, abort in-flight runs (their
  // SSE handlers emit 'cancelled'/'interrupted' and close), then flush the
  // store. Returns a promise that resolves once all active runs have aborted.
  ctx.beginDrain = () => {
    ctx.draining = true;
    for (const ac of _aborts.values()) { try { ac.abort(); } catch { /* already gone */ } }
    return _store.flush?.() ?? Promise.resolve();
  };

  const server = createServer(async (req, res) => {
    const head = req.method === 'HEAD';
    const t0 = Date.now();
    _metrics.inc('requests');
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.problemInstance = url.pathname;
      const ip = req.socket.remoteAddress ?? 'unknown';
      const isRun = req.method === 'POST' && /^\/api\/(conversations\/[^/]+\/chat|runs\/[^/]+\/resume|godmode|town\/tick)$/.test(url.pathname);
      // While draining, refuse new run-creating requests with 503 + Retry-After.
      if (ctx.draining && isRun) {
        res.setHeader('Retry-After', '5');
        return sendError(res, 503, 'server is draining; retry later', 'retry after the server restarts', head);
      }
      // Backpressure (#7): shed new runs when the concurrency cap is reached.
      if (isRun && ctx.aborts.size >= MAX_ACTIVE_RUNS) {
        res.setHeader('Retry-After', '2');
        return sendError(res, 503, 'too many active runs', 'retry shortly', head);
      }
      if (url.pathname.startsWith('/api/') && rateLimited(ip)) return sendError(res, 429, 'Too Many Requests', 'slow down', head);
      if (url.pathname.startsWith('/api/') && !checkToken(req)) return sendError(res, 401, 'Unauthorized', 'provide a valid VILLAGE_API_TOKEN', head);
      const handled = await route(req, res, url, ctx);
      // route() returns false only for non-API paths. Any other value means the
      // response was already written, including `return sendJson(...)` helpers
      // that used to leak `undefined` and trigger a second 405 write.
      if (handled !== false) { _metrics.observeLatency(Date.now() - t0); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Method Not Allowed', undefined, head);
      await serveStatic(req, res, url.pathname);
      _metrics.observeLatency(Date.now() - t0);
    } catch (err) {
      _metrics.inc('errors');
      const status = Number.isInteger(err?.status) ? err.status : 500;
      // Redact secrets from logged and returned errors (#11).
      if (status >= 500) console.error('[server]', redactError(err));
      if (!res.headersSent) sendError(res, status, status === 500 ? 'Internal Server Error' : redact(err.message), undefined, head);
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
  // Liveness (#9): process is up. Always 200 if the event loop is responding.
  if (parts.length === 2 && parts[1] === 'healthz' && method === 'GET') { sendJson(res, 200, { status: 'ok' }); return true; }
  // Readiness (#9): store loaded + write path OK + providers probed.
  if (parts.length === 2 && parts[1] === 'readyz' && method === 'GET') {
    const checks = { store: 'ok', write: 'ok', providers: 'ok' };
    let ok = true;
    try { await ctx.store.flush?.(); } catch { checks.write = 'fail'; ok = false; }
    if (process.env.VILLAGE_OFFLINE === '1' || process.env.VILLAGE_OFFLINE === 'true') {
      checks.providers = 'offline (mock)';
    } else {
      try { const p = await probeAllProviders(); if (p && typeof p === 'object') checks.providers = 'ok'; }
      catch { checks.providers = 'degraded'; }
    }
    if (ctx.draining) { checks.draining = true; ok = false; }
    sendJson(res, ok ? 200 : 503, { status: ok ? 'ready' : 'not_ready', checks });
    return true;
  }
  if (parts.length === 2 && parts[1] === 'metrics' && method === 'GET') { sendJson(res, 200, ctx.metrics.snapshot()); return true; }
  if (parts.length === 2 && parts[1] === 'providers' && method === 'GET') { sendJson(res, 200, { providers: listProviders(), default: defaultProvider() }); return true; }
  if (parts.length === 3 && parts[1] === 'providers' && parts[2] === 'health' && method === 'GET') { sendJson(res, 200, { ...(await probeAllProviders({ force: true })), breakers: providerHealth() }); return true; }
  if (parts.length === 2 && parts[1] === 'agents' && method === 'GET') { sendJson(res, 200, { agents: publicAgents() }); return true; }
  // Creative workbench: a deterministic, offline pre-production plan.
  if (parts.length === 3 && parts[1] === 'director' && parts[2] === 'formats' && method === 'GET') {
    sendJson(res, 200, {
      formats: Object.entries(FORMATS).map(([id, meta]) => ({ id, ...meta })),
      platforms: Object.entries(PLATFORMS).map(([id, data]) => ({ id, label: data.label, aspect: data.aspect, durationSeconds: data.durationSeconds })),
      aspects: Object.keys(ASPECTS),
      tones: TONE_NAMES,
      paces: PACE_NAMES,
      fps: FPS_VALUES,
    });
    return true;
  }
  if (parts.length === 3 && parts[1] === 'director' && parts[2] === 'plan' && method === 'POST') {
    const body = await readJson(req);
    try {
      const plan = planProject(body);
      sendJson(res, 200, { plan, exports: buildExports(plan) });
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 500;
      if (status >= 500) console.error('[director]', redactError(e));
      sendError(res, status, status >= 500 ? 'failed to build the plan' : e.message);
    }
    return true;
  }
  if (parts.length === 3 && parts[1] === 'director' && parts[2] === 'export' && method === 'POST') {
    const body = await readJson(req, 256 * 1024);
    try {
      sendJson(res, 200, exportProject(body));
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 500;
      if (status >= 500) console.error('[director]', redactError(e));
      sendError(res, status, status >= 500 ? 'failed to export the plan' : e.message);
    }
    return true;
  }
  // Risk-aware model routing (#40): pick a cost/complexity tier for a task.
  if (parts.length === 2 && parts[1] === 'route' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.message !== 'string' || !body.message.trim()) return sendError(res, 422, 'message required');
    sendJson(res, 200, routeModel({ message: body.message, context: body.context ?? {} }));
    return true;
  }
  if (parts.length === 2 && parts[1] === 'route' && method === 'GET') { sendJson(res, 200, { models: listAvailableModels() }); return true; }

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
    if (!c) return sendError(res, 404, 'not found');
    if (ownerOf(c) !== user) return sendError(res, 403, 'forbidden');
    sendJson(res, 200, c); return true;
  }
  if (parts.length === 4 && parts[1] === 'conversations' && parts[3] === 'chat' && method === 'POST') {
    await handleChat(req, res, parts[2], ctx, user); return true;
  }

  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'cancel' && method === 'POST') {
    const owned = ownedRun(ctx, parts[2], user);
    if (owned.error) return sendError(res, ...owned.error);
    const ac = ctx.aborts.get(parts[2]);
    if (!ac) return sendError(res, 409, `run is ${owned.run.status}`);
    ctx.metrics.inc('cancels');
    ac.abort();
    sendJson(res, 200, { cancelled: true }); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'suspend' && method === 'POST') {
    const owned = ownedRun(ctx, parts[2], user);
    if (owned.error) return sendError(res, ...owned.error);
    const run = owned.run;
    if (run.status !== 'running') return sendError(res, 409, `run is ${run.status}`);
    run.status = 'suspended';
    await ctx.store.save();
    ctx.metrics.inc('cancels');
    ctx.writers.get(parts[2])?.('suspended', { type: 'suspended', runId: parts[2] });
    sendJson(res, 200, { suspended: true, run }); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'checkpoints' && method === 'GET') {
    const owned = ownedRun(ctx, parts[2], user);
    if (owned.error) return sendError(res, ...owned.error);
    sendJson(res, 200, { run: owned.run, checkpoints: ctx.store.listCheckpoints(parts[2]) }); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'events' && method === 'GET') {
    const owned = ownedRun(ctx, parts[2], user);
    if (owned.error) return sendError(res, ...owned.error);
    sendJson(res, 200, { run: owned.run, events: ctx.store.listEvents(parts[2]) }); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'resume' && method === 'POST') {
    await handleResume(req, res, parts[2], ctx, user); return true;
  }
  if (parts.length === 4 && parts[1] === 'runs' && parts[3] === 'export' && method === 'GET') {
    const owned = ownedRun(ctx, parts[2], user);
    if (owned.error) return sendError(res, ...owned.error);
    const run = owned.run;
    const conv = ctx.store.getConversation(run.conversationId);
    // Redact secrets from the export body before signing (#11/#20). The
    // signature covers the redacted content so it stays verifiable.
    const safe = redact({ run, conversation: conv, events: ctx.store.listEvents(parts[2]) });
    let signed;
    try { signed = signExport(safe); }
    catch (e) { return sendError(res, 503, e.message); }
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
  if (parts.length === 3 && parts[1] === 'memory' && parts[2] === 'reflect' && method === 'POST') {
    const provider = defaultProvider();
    try {
      const result = await ctx.archivist.reflect({ user, llm: { chatStream, chatStreamWithFallback, providerChain }, provider });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 200, { skipped: true, reason: err.message });
    }
    return true;
  }
  if (parts.length === 3 && parts[1] === 'memory' && parts[2] === 'stats' && method === 'GET') {
    sendJson(res, 200, ctx.archivist.stats({ user }));
    return true;
  }

  /* --- town: wants board --- */
  if (parts.length === 2 && parts[1] === 'wants' && method === 'GET') {
    const status = url.searchParams.get('status') ?? 'open';
    sendJson(res, 200, { wants: ctx.wants.list({ status }) });
    return true;
  }
  if (parts.length === 2 && parts[1] === 'wants' && method === 'POST') {
    const idemKey = idempotencyKey(req, user, 'wants');
    if (idemKey) { const c = idempotencyGet(idemKey); if (c) { sendJson(res, c.status, c.body); return true; } }
    const body = await readJson(req);
    try {
      const want = ctx.wants.post({ ...body, user });
      if (idemKey) idempotencySet(idemKey, 201, want);
      sendJson(res, 201, want);
    } catch (e) {
      sendError(res, 422, e.message);
    }
    return true;
  }
  if (parts.length === 4 && parts[1] === 'wants' && parts[3] === 'claim' && method === 'POST') {
    try {
      sendJson(res, 200, ctx.wants.claim(parts[2], { by: 'citizen' }));
    } catch (e) {
      sendError(res, 409, e.message);
    }
    return true;
  }
  if (parts.length === 4 && parts[1] === 'wants' && parts[3] === 'fulfill' && method === 'POST') {
    const body = await readJson(req);
    try {
      sendJson(res, 200, ctx.wants.fulfill(parts[2], { by: body.agent ?? 'citizen', result: body.result ?? '' }));
    } catch (e) {
      sendError(res, 409, e.message);
    }
    return true;
  }
  if (parts.length === 4 && parts[1] === 'wants' && parts[3] === 'cancel' && method === 'POST') {
    try {
      sendJson(res, 200, ctx.wants.cancel(parts[2], { user }));
    } catch (e) {
      sendError(res, 409, e.message);
    }
    return true;
  }

  /* --- town: god mode + world events --- */
  if (parts.length === 2 && parts[1] === 'godmode' && method === 'POST') {
    const idemKey = idempotencyKey(req, user, 'godmode');
    if (idemKey) { const c = idempotencyGet(idemKey); if (c) { sendJson(res, c.status, c.body); return true; } }
    const body = await readJson(req);
    try {
      const result = ctx.god.act({ ...body, user });
      if (idemKey) idempotencySet(idemKey, 201, result);
      sendJson(res, 201, result);
    } catch (e) {
      sendError(res, 422, e.message);
    }
    return true;
  }
  if (parts.length === 3 && parts[1] === 'world' && parts[2] === 'events' && method === 'GET') {
    sendJson(res, 200, { events: ctx.god.list({ limit: 100 }) });
    return true;
  }
  if (parts.length === 3 && parts[1] === 'world' && parts[2] === 'stream' && method === 'GET') {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // Track a cursor into the append-only world log rather than the last
    // timestamp: several events can share a millisecond, and a `ts > last`
    // filter would silently drop all but the first of them.
    let cursor = 0;
    const flush = () => {
      const world = ctx.store.data.world ?? [];
      if (world.length < cursor) cursor = 0; // world was reset/replaced
      for (; cursor < world.length; cursor++) {
        const e = world[cursor];
        try { res.write(`event: world_event\ndata: ${JSON.stringify(e)}\n\n`); }
        catch { return; }
      }
    };
    flush();
    const timer = setInterval(flush, 2000);
    // `req` 'close' can fire when the request body is consumed, which for a
    // GET is immediately; `res` 'close' tracks the actual response lifetime.
    res.on('close', () => clearInterval(timer));
    return true;
  }

  /* --- town: chronicle, stats, tick --- */
  if (parts.length === 2 && parts[1] === 'chronicle' && method === 'GET') {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8' });
    res.end(ctx.chronicle.build({ user }));
    return true;
  }
  if (parts.length === 3 && parts[1] === 'town' && parts[2] === 'stats' && method === 'GET') {
    sendJson(res, 200, ctx.town.stats());
    return true;
  }
  if (parts.length === 3 && parts[1] === 'town' && parts[2] === 'tick' && method === 'POST') {
    const idemKey = idempotencyKey(req, user, 'town-tick');
    if (idemKey) { const c = idempotencyGet(idemKey); if (c) { sendJson(res, c.status, c.body); return true; } }
    const result = ctx.town.tick({ user });
    if (idemKey) idempotencySet(idemKey, 200, result);
    sendJson(res, 200, result);
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
      if (typeof body.text !== 'string' || !body.text.trim()) return sendError(res, 422, 'text required');
      const m = await ctx.memory.add(body.text.trim(), body.tags ?? [], user);
      sendJson(res, 201, m); return true;
    }
  }

  if (parts.length === 2 && parts[1] === 'feedback' && method === 'POST') {
    const body = await readJson(req);
    if (typeof body.text !== 'string' || !body.text.trim()) return sendError(res, 422, 'text required');
    const m = await ctx.memory.add(`[feedback] ${body.text.trim()}`, body.tags ?? [], user);
    sendJson(res, 201, m); return true;
  }

  sendError(res, 404, 'not found');
  return true;
}

async function handleChat(req, res, conversationId, ctx, user) {
  const conversation = ctx.store.getConversation(conversationId);
  if (!conversation) return sendError(res, 404, 'conversation not found');
  if (ownerOf(conversation) !== user) return sendError(res, 403, 'forbidden');

  // Idempotency (#8): a reused Idempotency-Key must not trigger a second run.
  // Chat is a stream, so we refuse the duplicate with 409 + the original run id.
  const idemKey = idempotencyKey(req, user, `chat:${conversationId}`);
  if (idemKey) {
    const c = idempotencyGet(idemKey);
    if (c) return sendError(res, 409, 'duplicate request (idempotency key already used)', `original run: ${c.body?.runId ?? 'unknown'}`);
  }

  const body = await readJson(req);
  if (typeof body.message !== 'string' || !body.message.trim()) return sendError(res, 422, 'message required');
  if (body.message.length > MAX_MESSAGE) return sendError(res, 422, `message exceeds ${MAX_MESSAGE} characters`);

  ctx.metrics.inc('chats');
  await ctx.store.appendMessage(conversationId, { role: 'user', content: body.message });

  const provider = body.provider ?? conversation.provider ?? defaultProvider();
  const run = ctx.store.createRun({ conversationId, provider, user, mission: body.message });
  if (idemKey) idempotencySet(idemKey, 200, { runId: run.id, status: 'streaming' });
  await streamRun(req, res, { ctx, user, conversationId, runId: run.id, message: body.message, provider, resume: false });
}

// Resume (#1): continue an interrupted/failed run from its last completed
// checkpoint. Reuses the run id and conversation; skips phases that already
// checkpointed (so side-effecting tools never re-run) and re-emits their
// cached outputs as events.
async function handleResume(req, res, runId, ctx, user) {
  const owned = ownedRun(ctx, runId, user);
  if (owned.error) return sendError(res, ...owned.error);
  const run = owned.run;
  const conversation = ctx.store.getConversation(run.conversationId);
  if (!conversation) return sendError(res, 404, 'conversation not found');
  if (ownerOf(conversation) !== user) return sendError(res, 403, 'forbidden');
  if (run.status === 'running') return sendError(res, 409, 'run is still in progress');

  // Recover the original request from the conversation's last user message.
  const lastUser = [...conversation.messages].reverse().find((m) => m.role === 'user');
  if (!lastUser?.content) return sendError(res, 422, 'no user message to resume');

  ctx.metrics.inc('chats');
  // Reset the run to running; prior events/checkpoints are preserved, but a
  // stale terminal error must not linger on the resumed run.
  run.status = 'running';
  delete run.error;
  delete run.finishedAt;
  await ctx.store.save();
  await streamRun(req, res, { ctx, user, conversationId: run.conversationId, runId, message: run.mission || lastUser.content, provider: run.provider ?? defaultProvider(), resume: true });
}

// Shared SSE streaming for a run (new or resumed). Wires the abort controller,
// pumps orchestrate() events to the client, and finalizes run status.
async function streamRun(req, res, { ctx, user, conversationId, runId, message, provider, resume }) {
  const ac = new AbortController();
  ctx.aborts.set(runId, ac);

  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Run-Id': runId, 'X-SSE-Schema': String(SSE_SCHEMA_VERSION) });

  let closed = false;
  let suspended = false;
  let lastPhase = 'queued';

  // SSE event IDs (#3): every persisted event carries the store's monotonic
  // `seq` as its `id:`. A reconnect with Last-Event-ID therefore resumes
  // exactly where the client stopped; SSE-only liveness heartbeats carry no
  // id and never advance the replay cursor. Client disconnect aborts the
  // orchestrator so a dead browser does not keep burning provider budget.
  const emit = (event, data, id) => {
    if (closed) return;
    const idLine = id == null ? '' : `id: ${id}\n`;
    try { res.write(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { closed = true; try { ac.abort(); } catch { /* already closed */ } }
  };
  res.on('close', () => {
    if (closed || res.writableEnded) return;
    closed = true;
    try { ac.abort(); } catch { /* already closed */ }
  });

  // Replay missed events on reconnect (#3) BEFORE emitting any new event, so
  // the client's replay cursor moves forward monotonically. A live `run_id`
  // marker follows the replay but carries no id and is not persisted; sending
  // a freshly persisted run_id first would give the client a high id followed
  // by the lower ids it actually missed.
  const lastEventId = Number(req.headers['last-event-id']);
  const replaying = Number.isInteger(lastEventId) && lastEventId > 0;
  if (replaying) {
    for (const e of ctx.store.listEvents(runId)) {
      if (e.seq <= lastEventId) continue;
      emit(e.type, e, e.seq);
      if (closed) break;
    }
    emit('run_id', { runId, schemaVersion: SSE_SCHEMA_VERSION, resumedFrom: lastEventId });
  } else {
    const runEvent = ctx.store.appendEvent(runId, { type: 'run_id', runId, schemaVersion: SSE_SCHEMA_VERSION });
    // Keep the live payload backward compatible (`runId` first); replay sends
    // the persisted record, which also carries `type` and `seq`.
    emit('run_id', { runId, schemaVersion: SSE_SCHEMA_VERSION, seq: runEvent.seq }, runEvent.seq);
  }
  ctx.writers.set(runId, emit);

  // Heartbeat (DUR-030): the orchestrator persists a heartbeat per event; the
  // SSE stream also emits one every 15s so a client can distinguish a long
  // model call from a dead connection.
  const heartbeat = setInterval(() => {
    const at = Date.now();
    ctx.store.heartbeat?.(runId, { phase: lastPhase });
    emit('heartbeat', { runId, phase: lastPhase, at });
  }, 15_000);
  heartbeat.unref?.();

  try {
    for await (const evt of orchestrate({ message, provider, user, store: ctx.store, conversationId, runId, signal: ac.signal, resume })) {
      if (evt.phase) lastPhase = evt.phase;
      emit(evt.type, evt, evt.seq);
      if (evt.type === 'suspended') suspended = true;
      if (evt.type === 'security_decision' && (evt.decision.verdict === 'deny')) ctx.metrics.inc('securityDenials');
      if (evt.type === 'critique' && evt.verdict.overall === 'reject') ctx.metrics.inc('criticRejects');
      if (evt.type === 'message_end') await ctx.store.appendMessage(conversationId, { role: 'agent', agentId: evt.agentId, content: evt.content });
    }
    await ctx.store.finishRun(runId, { status: suspended ? 'suspended' : 'ok' });
  } catch (err) {
    if (err.name === 'AbortError') {
      const status = ctx.draining ? 'interrupted' : 'cancelled';
      const failure = classifyFailure({ type: status, message: err.message });
      const record = ctx.store.appendEvent(runId, { type: status, runId, status, failure });
      emit(status, record, record.seq);
      await ctx.store.finishRun(runId, { status });
    }
    else {
      console.error('[chat]', err);
      const failure = classifyFailure(err);
      const record = ctx.store.appendEvent(runId, { type: 'error', runId, message: err.message, failure });
      emit('error', record, record.seq);
      await ctx.store.finishRun(runId, { status: 'error', error: err.message });
    }
  } finally {
    clearInterval(heartbeat);
    ctx.writers.delete(runId);
    ctx.aborts.delete(runId);
    if (!closed) { try { res.end(); } catch {} }
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { server, store, ctx } = createApp();
  try {
    await store.load();
  } catch (e) {
    // A corrupt file is already preserved by Store.load. Refusing to boot
    // forever is worse than starting with an empty store; a version mismatch,
    // by contrast, must abort so a newer schema is never overwritten.
    if (e.code !== 'STORE_CORRUPT') throw e;
    console.error(`[server] ${e.message}; starting with a fresh store`);
    await store.save();
  }
  // Crash detection (DUR-031): nothing can still be running in a fresh process,
  // so any run left as `running` is interrupted. Mark it honestly instead of
  // leaving clients to wait on a stream that will never resume.
  const interrupted = await recoverInterruptedRuns(store, { staleAfterMs: 0 });
  if (interrupted.length) console.log(`[server] marked ${interrupted.length} orphaned run(s) interrupted`);
  server.listen(PORT, HOST, () => console.log(`Agent Village v3 listening on http://${HOST}:${PORT}`));

  // Graceful shutdown (#4): stop accepting new runs, abort in-flight runs,
  // flush the store, then close. A hard timeout guarantees exit if drain hangs
  // (e.g. a stuck SSE client or a slow provider that ignores the abort).
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received; draining`);
    const forceExit = setTimeout(() => { console.error('[server] drain timed out; forcing exit'); process.exit(1); }, 10_000);
    forceExit.unref();
    Promise.resolve()
      .then(() => ctx.beginDrain())
      .then(() => new Promise((r) => server.close(r)))
      .then(() => { clearTimeout(forceExit); console.log('[server] drained cleanly'); process.exit(0); })
      .catch((e) => { console.error('[server] drain error:', e); process.exit(1); });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}