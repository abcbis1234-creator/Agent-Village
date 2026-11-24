import { isRetryable } from './retry.mjs';

const PROVIDERS = {
  openai: {
    kind: 'openai',
    base: () => process.env.OPENAI_BASE ?? 'https://api.openai.com/v1',
    key: () => process.env.OPENAI_API_KEY,
    model: () => process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  ollama: {
    kind: 'ollama',
    base: () => process.env.OLLAMA_BASE ?? 'http://127.0.0.1:11434',
    key: () => null,
    model: () => process.env.OLLAMA_MODEL ?? 'llama3.2',
  },
  anthropic: {
    kind: 'anthropic',
    base: () => process.env.ANTHROPIC_BASE ?? 'https://api.anthropic.com/v1',
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
  },
  mock: { kind: 'mock' },
};

// Per-provider circuit breaker (ported in spirit from llm-fallback-router).
// closed → normal; open → instant skip; half_open → one probe at a time.
export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 0.5;
    this.windowMs = options.windowMs ?? 30_000;
    this.cooldownMs = options.cooldownMs ?? 15_000;
    this.halfOpenSuccesses = options.halfOpenSuccesses ?? 2;
    this.minimumRequests = options.minimumRequests ?? 5;
    this.maxSamples = options.maxSamples ?? 256;
    this.now = options.now ?? Date.now;
    this.outcomes = [];
    this._state = 'closed';
    this.openedAt = 0;
    this.halfOpenOk = 0;
    this.halfOpenInFlight = 0;
  }

  current() {
    if (this._state === 'open' && this.now() - this.openedAt >= this.cooldownMs) {
      this._state = 'half_open';
      this.halfOpenOk = 0;
      this.halfOpenInFlight = 0;
    }
    return this._state;
  }

  canRequest() {
    const s = this.current();
    if (s === 'open') return false;
    if (s === 'half_open') {
      if (this.halfOpenInFlight > 0) return false;
      this.halfOpenInFlight += 1;
      return true;
    }
    return true;
  }

  onSuccess() {
    this._record(true);
    if (this._state === 'half_open') {
      this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      this.halfOpenOk += 1;
      if (this.halfOpenOk >= this.halfOpenSuccesses) this._close();
    }
  }

  onFailure() {
    this._record(false);
    if (this._state === 'half_open') { this._trip(); return; }
    if (this._state === 'closed' && this.failureRate() >= this.failureThreshold) this._trip();
  }

  failureRate() {
    this._prune();
    if (this.outcomes.length < this.minimumRequests) return 0;
    return this.outcomes.reduce((n, o) => n + (o.ok ? 0 : 1), 0) / this.outcomes.length;
  }

  _record(ok) { this.outcomes.push({ t: this.now(), ok }); this._prune(); }

  _prune() {
    const cutoff = this.now() - this.windowMs;
    let i = 0;
    while (i < this.outcomes.length && this.outcomes[i].t < cutoff) i += 1;
    const overflow = this.outcomes.length - i - this.maxSamples;
    if (overflow > 0) i += overflow;
    if (i > 0) this.outcomes.splice(0, i);
  }

  _trip() { this._state = 'open'; this.openedAt = this.now(); this.halfOpenInFlight = 0; }
  _close() { this._state = 'closed'; this.outcomes = []; this.halfOpenOk = 0; this.halfOpenInFlight = 0; }
  // Release a half-open probe slot when a request is cancelled before it can
  // succeed or fail (AbortError / consumer stopped early).
  onAbort() {
    if (this._state === 'half_open') this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
  }
  snapshot() { return { state: this.current(), failureRate: Number(this.failureRate().toFixed(3)), samples: this.outcomes.length }; }
}

const BREAKERS = new Map();
export function breakerFor(id) {
  if (!BREAKERS.has(id)) BREAKERS.set(id, new CircuitBreaker());
  return BREAKERS.get(id);
}
export function resetBreakers() { BREAKERS.clear(); }
export function providerHealth() {
  return Object.fromEntries([...BREAKERS.entries()].map(([id, b]) => [id, b.snapshot()]));
}

export function listProviders() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, {
    id,
    // `configured` means "actually usable": a key for cloud providers, an explicit
    // OLLAMA_BASE for Ollama. Mock is always available.
    configured: p.kind === 'mock' ? true : (id === 'ollama' ? Boolean(process.env.OLLAMA_BASE) : Boolean(p.key?.())),
    model: p.model?.() ?? null,
    hasKey: p.kind === 'mock' ? false : Boolean(p.key?.()),
  }]));
}

export function defaultProvider() {
  // Offline/local-first profile (#99): force mock so core workflows run with
  // no external network. Set VILLAGE_OFFLINE=1 (or --offline).
  if (process.env.VILLAGE_OFFLINE === '1' || process.env.VILLAGE_OFFLINE === 'true') return 'mock';
  const explicit = process.env.VILLAGE_PROVIDER;
  if (explicit && PROVIDERS[explicit]) return explicit;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (id !== 'mock' && p.kind !== 'mock' && p.key?.()) return id;
  }
  return 'mock';
}

// Ordered failover chain for a given primary provider. The primary is always
// first; then every other *configured* provider (cloud with a key, Ollama with
// an explicit OLLAMA_BASE). `mock` is appended only when requested so callers
// that never want silent live fallback (tests, security L2) can opt out. This
// is the single source of truth for failover order across the orchestrator,
// scout, critic, archivist, and security reviewer.
export function providerChain(primary, { includeMock = false } = {}) {
  const chain = [];
  if (primary) chain.push(primary);
  for (const [id, p] of Object.entries(listProviders())) {
    if (id === primary || id === 'mock') continue;
    if (p.configured || (id === 'ollama' && process.env.OLLAMA_BASE)) chain.push(id);
  }
  if (includeMock && !chain.includes('mock')) chain.push('mock');
  return chain;
}

function mockResponse({ system, messages }) {
  const last = String(messages[messages.length - 1]?.content ?? '');
  if (/return only json/i.test(system) || /only.*json/i.test(system)) {
    if (/scout/i.test(system)) return '{"intent":"general","domain":"general","ambiguities":[],"suggestedTools":[]}';
    if (/planner/i.test(system)) {
      const m = last.match(/[-\d\s().+*/]{3,}/g)?.find((c) => /\d/.test(c) && /[+\-*/]/.test(c));
      if (m) return JSON.stringify({ steps: [{ tool: 'calculator', args: { expression: m.trim() } }] });
      return '{"steps":[]}';
    }
    if (/falsification/i.test(system)) return '{"fatal":false,"finding":"none found","evidence":"","confidence":0.75}';
    if (/caller verification/i.test(system)) return '{"satisfies":true,"gaps":[],"confidence":0.75}';
    if (/steelman/i.test(system)) return '{"counterCase":"no strong counter","counterSucceeds":false,"confidence":0.75}';
    return '{"steps":[]}';
  }
  if (/archivist/i.test(system) && /synthesize/i.test(last)) {
    return '{"beliefs":[]}';
  }
  return `[mock] reviewed: "${last.slice(0, 160)}"`;
}

async function* streamText(text) {
  const chunks = text.match(/.{1,8}/g) ?? [];
  for (const c of chunks) yield { delta: c, done: false };
  yield { delta: '', done: true };
}

async function* sseOpenAI(res) {
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
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { yield { delta: '', done: true }; return; }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield { delta, done: false };
        } catch {}
      }
    }
  }
}

async function* sseOllama(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.message?.content) yield { delta: json.message.content, done: false };
        if (json.done) { yield { delta: '', done: true }; return; }
      } catch {}
    }
  }
}

async function* sseAnthropic(res) {
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
      let event = '';
      const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
      }
      if (!data.length) continue;
      try {
        const json = JSON.parse(data.join('\n'));
        if (event === 'content_block_delta' && json.delta?.text) yield { delta: json.delta.text, done: false };
        if (event === 'message_stop') { yield { delta: '', done: true }; return; }
      } catch {}
    }
  }
}

export async function* chatStream({ provider, system, messages, maxTokens = 512, signal }) {
  const id = provider ?? defaultProvider();
  const p = PROVIDERS[id];
  if (!p) throw new Error(`unknown provider: ${id}`);

  if (p.kind === 'mock') {
    yield* streamText(mockResponse({ system, messages }));
    return;
  }

  const breaker = breakerFor(id);
  if (!breaker.canRequest()) {
    const err = new Error(`provider ${id} is unavailable (circuit open)`);
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  try {
    if (p.kind === 'openai') {
      const res = await fetch(`${p.base()}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key()}` },
        body: JSON.stringify({
          model: p.model(), stream: true, max_tokens: maxTokens,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
      yield* sseOpenAI(res);
      breaker.onSuccess();
      return;
    }

    if (p.kind === 'ollama') {
      const res = await fetch(`${p.base()}/api/chat`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: p.model(), stream: true, options: { num_predict: maxTokens },
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
      yield* sseOllama(res);
      breaker.onSuccess();
      return;
    }

    if (p.kind === 'anthropic') {
      const res = await fetch(`${p.base()}/messages`, {
        method: 'POST', signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': p.key(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: p.model(), stream: true, max_tokens: maxTokens, system,
          messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
      yield* sseAnthropic(res);
      breaker.onSuccess();
      return;
    }

    throw new Error(`unhandled kind: ${p.kind}`);
  } catch (e) {
    if (e?.name !== 'AbortError') breaker.onFailure();
    throw e;
  } finally {
    breaker.onAbort();
  }
}

// Try a priority chain of providers. Each provider is retried on transient
// failures (429/timeout/5xx) before moving to the next; a provider that fails
// before emitting any text is retried/skipped, while a provider that already
// streamed partial output is rethrown (you cannot un-stream a half answer).
export async function* chatStreamWithFallback({ providers, retries = 2, ...options }) {
  const chain = Array.isArray(providers)
    ? providers.filter(Boolean)
    : [providers ?? options.provider ?? defaultProvider()];
  if (!chain.length) chain.push(defaultProvider());
  // Honour a pre-aborted signal before doing any work.
  if (options.signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
  const errors = [];
  for (const id of chain) {
    let emitted = false;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        for await (const chunk of chatStream({ ...options, provider: id })) {
          if (chunk.delta) emitted = true;
          yield chunk;
        }
        return; // success — stream complete
      } catch (e) {
        errors.push(`${id}${attempt ? ` (retry ${attempt})` : ''}: ${e.message}`);
        if (e?.name === 'AbortError') throw e; // caller cancelled
        if (emitted) throw e; // partial output — cannot retry
        if (!isRetryable(e) || attempt >= retries) break; // give up on this provider
        // else: retry the same provider
      }
    }
  }
  const err = new Error(`all providers failed: ${errors.join(' | ')}`);
  err.code = 'ALL_PROVIDERS_FAILED';
  throw err;
}

export async function probeProvider(id, timeoutMs = 3000) {
  const p = PROVIDERS[id];
  if (!p) return { id, ok: false, error: 'unknown' };
  if (p.kind === 'mock') return { id, ok: true, kind: 'mock', latencyMs: 0 };
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(p.base(), { signal: ac.signal, headers: p.key?.() ? { Authorization: `Bearer ${p.key()}` } : {} });
    return { id, ok: res.ok || res.status === 401 || res.status === 404, status: res.status, latencyMs: Date.now() - t0, kind: p.kind };
  } catch (e) {
    return { id, ok: false, error: e.message, latencyMs: Date.now() - t0, kind: p.kind };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAllProviders() {
  const ids = Object.keys(PROVIDERS);
  const results = await Promise.all(ids.map((id) => probeProvider(id)));
  return Object.fromEntries(results.map((r) => [r.id, r]));
}