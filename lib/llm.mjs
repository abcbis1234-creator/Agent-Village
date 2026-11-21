import { route } from './routing/free-first.mjs';

const PROVIDERS = {
  openai: {
    kind: 'openai',
    base: () => process.env.OPENAI_BASE ?? 'https://api.openai.com/v1',
    key: () => process.env.OPENAI_API_KEY,
    model: () => process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    healthPath: '/models',
  },
  ollama: {
    kind: 'ollama',
    base: () => process.env.OLLAMA_BASE ?? 'http://127.0.0.1:11434',
    key: () => null,
    model: () => process.env.OLLAMA_MODEL ?? 'llama3.2',
    healthPath: '/api/tags',
  },
  anthropic: {
    kind: 'anthropic',
    base: () => process.env.ANTHROPIC_BASE ?? 'https://api.anthropic.com/v1',
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
    healthPath: null,
  },
  mock: { kind: 'mock' },
};

export function listProviders() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [id, {
      id,
      configured: p.kind === 'mock' ? true : Boolean(p.base?.() && (!p.key?.() || p.key())),
      model: p.model?.() ?? null,
      hasKey: p.kind === 'mock' ? false : Boolean(p.key?.()),
    }])
  );
}

export function defaultProvider() {
  const explicit = process.env.VILLAGE_PROVIDER;
  if (explicit && PROVIDERS[explicit]) return explicit;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (id === 'mock') continue;
    if (p.kind !== 'mock' && p.key?.()) return id;
  }
  return 'mock';
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

function mockStream({ system, messages, maxTokens = 512 }) {
  const last = messages[messages.length - 1]?.content ?? '';
  const text = `[mock] role="${String(system).slice(0, 40)}…" you said: "${String(last).slice(0, 200)}"`;
  const chunks = text.match(/.{1,12}/g) ?? [];
  return (async function* () {
    let tokens = 0;
    for (const c of chunks) { tokens += 1; yield { delta: c, done: false, tokens }; }
    yield { delta: '', done: true, tokens };
  })();
}

export async function* chatStream({ provider, system, messages, maxTokens = 512, signal }) {
  let id = provider;
  if (!id) {
    const routeResult = route({ message: messages[messages.length - 1]?.content ?? '' });
    const tierToProvider = { local: 'ollama', 'free-api': 'openai', paid: 'anthropic' };
    id = tierToProvider[routeResult.tier] ?? 'mock';
  }
  const p = PROVIDERS[id];
  if (!p) throw new Error(`unknown provider: ${id}`);

  if (p.kind === 'mock') {
    yield* mockStream({ system, messages, maxTokens });
    return;
  }

  if (p.kind === 'openai') {
    const res = await fetch(`${p.base()}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${p.key()}`,
      },
      body: JSON.stringify({
        model: p.model(),
        stream: true,
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text().catch(() => '')}`);
    yield* sseOpenAI(res);
    return;
  }

  if (p.kind === 'ollama') {
    const res = await fetch(`${p.base()}/api/chat`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model(),
        stream: true,
        options: { num_predict: maxTokens },
        messages: [{ role: 'system', content: system }, ...messages],
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text().catch(() => '')}`);
    yield* sseOllama(res);
    return;
  }

  if (p.kind === 'anthropic') {
    const res = await fetch(`${p.base()}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.key(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: p.model(),
        stream: true,
        max_tokens: maxTokens,
        system,
        messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text().catch(() => '')}`);
    yield* sseAnthropic(res);
    return;
  }

  throw new Error(`unhandled provider kind: ${p.kind}`);
}

export async function probeProvider(id, timeoutMs = 3000) {
  const p = PROVIDERS[id];
  if (!p) return { id, ok: false, error: 'unknown provider' };
  if (p.kind === 'mock') return { id, ok: true, kind: 'mock', latencyMs: 0 };
  const url = p.healthPath ? `${p.base()}${p.healthPath}` : p.base();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: ac.signal, headers: p.key?.() ? { Authorization: `Bearer ${p.key()}` } : {} });
    return { id, ok: res.ok || res.status === 401, status: res.status, latencyMs: Date.now() - t0, kind: p.kind };
  } catch (e) {
    return { id, ok: false, error: e.message, latencyMs: Date.now() - t0, kind: p.kind };
  } finally { clearTimeout(timer); }
}

export async function probeAllProviders() {
  const ids = Object.keys(PROVIDERS);
  const results = await Promise.all(ids.map((id) => probeProvider(id)));
  return Object.fromEntries(results.map((r) => [r.id, r]));
}
