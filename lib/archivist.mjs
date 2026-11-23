import { embed, cosine } from './memory.mjs';
import { checkContent, CONTEXTS } from './security.mjs';
import { extractJson } from './json.mjs';

const TYPES = ['episodic', 'semantic', 'procedural', 'core'];

export class Archivist {
  constructor(store, opts = {}) {
    this.store = store;
    this.reflectionThreshold = opts.reflectionThreshold ?? 30; // Smallville importance_trigger_max
    this.decayHalfLifeDays = opts.decayHalfLifeDays ?? 30;
    this.maxMemories = opts.maxMemories ?? 5000;
    this._reflectionPressure = 0;
  }

  async record({ type = 'episodic', text, importance = 3, tags = [], user = 'anon', provenance = [], confidence = 1 }) {
    if (!TYPES.includes(type)) throw new Error(`unknown type: ${type}`);
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('text is required');

    // Memory-write guard: never persist secrets or invisible-unicode payloads.
    const guard = checkContent(clean, { context: CONTEXTS.MEMORY_WRITE });
    if (guard.severity === 'critical') {
      const err = new Error('refusing to store unsafe content in memory');
      err.code = 'UNSAFE_MEMORY';
      err.findings = guard.findings;
      throw err;
    }

    const vec = embed(clean);

    const existing = this.store.listMemories(user);
    for (const m of existing) {
      if (m.supersededBy) continue;
      if (m.type === type && cosine(vec, Float32Array.from(m.vec ?? [])) > 0.96) {
        // Idempotent: refresh recency and access count instead of duplicating.
        m.lastAccessedAt = Date.now();
        m.accessCount = (m.accessCount ?? 0) + 1;
        return m;
      }
    }

    const entry = {
      id: crypto.randomUUID(), type, text: clean,
      importance: clamp(importance, 1, 5), tags, user, provenance,
      createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0,
      confidence, supersededBy: null,
      vec: Array.from(vec, (x) => Math.round(x * 1e4) / 1e4),
    };
    await this.store.addMemoryRecord(entry);

    // Cap the store so memory cannot grow without bound.
    const mems = this.store.data?.memories;
    if (Array.isArray(mems) && mems.length > this.maxMemories) {
      mems.splice(0, mems.length - this.maxMemories);
    }

    // Smallville reflection trigger: poignancy pressure. When the accumulated
    // importance crosses the threshold, queue a reflection for the Archivist.
    this._reflectionPressure += entry.importance;
    if (this._reflectionPressure >= this.reflectionThreshold) {
      this._reflectionPressure = 0;
      try { await this.store.queueReflection?.(user); } catch { /* queue is best-effort */ }
      entry.reflectionQueued = true;
    }

    return entry;
  }

  // Contradiction handling: never overwrite. Mark the old belief superseded and
  // append the correction with provenance back to it.
  async correct(memoryId, { correction, user = 'anon' } = {}) {
    const target = this.store.listMemories(user).find((m) => m.id === memoryId);
    if (!target) throw new Error('memory not found');
    target.confidence = Math.max(0.1, (target.confidence ?? 1) - 0.4);
    target.supersededBy = 'corrected';
    return this.record({
      type: target.type,
      text: correction,
      importance: target.importance ?? 3,
      user,
      provenance: [memoryId],
      tags: ['correction'],
    });
  }

  retrieve(query, { user = 'anon', k = 6, types = null, minScore = 0.12 } = {}) {
    const now = Date.now();
    const q = embed(query);
    const all = this.store.listMemories(user).filter((m) => !m.supersededBy);
    const pool = types ? all.filter((m) => types.includes(m.type)) : all;
    return pool
      .map((m) => {
        const relevance = cosine(q, Float32Array.from(m.vec ?? []));
        const ageDays = (now - m.createdAt) / 86_400_000;
        const recency = Math.exp(-ageDays / this.decayHalfLifeDays);
        const importance = (m.importance ?? 3) / 5;
        return { memory: m, score: 0.5 * relevance + 0.3 * recency + 0.2 * importance, relevance, recency, importance };
      })
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /* ---------- reflection (Smallville-style synthesis) ---------- */

  async reflect({ user = 'anon', llm, provider } = {}) {
    if (!llm?.chatStream) return { skipped: true, reason: 'no llm', beliefs: [] };

    const recent = (this.store.listMemories(user) ?? [])
      .filter((m) => m.type === 'episodic' && !m.supersededBy)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 20);

    if (recent.length < 3) return { skipped: true, reason: 'not enough episodic memories', beliefs: [] };

    const system = `You are the Archivist. Synthesize the following episodic memories into 1-3 higher-order semantic beliefs.
Return ONLY JSON: {"beliefs":[{"text":"...","importance":1-5,"supports":["memory ids"]}]}
Rules:
- Each belief must be supported by at least one listed memory id.
- Do not invent facts beyond the memories.
- Max 3 beliefs. Return ONLY JSON. No prose.`;

    const body = recent.map((m) => `[${m.id}] (importance ${m.importance}) ${m.text}`).join('\n');

    // Prefer the failover-aware stream when the caller injects it; fall back to
    // the plain stream so older callers/tests keep working. The provider chain
    // is supplied by the caller (providerChain(primary)) when available.
    const stream = llm.chatStreamWithFallback && Array.isArray(llm.providerChain)
      ? llm.chatStreamWithFallback({ providers: llm.providerChain(provider), system, messages: [{ role: 'user', content: body }], maxTokens: 300 })
      : llm.chatStream({ provider, system, messages: [{ role: 'user', content: body }], maxTokens: 300 });

    let text = '';
    for await (const { delta, done } of stream) {
      if (done) break;
      text += delta;
    }

    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.beliefs)) return { skipped: true, reason: 'unparseable', beliefs: [] };

    const created = [];
    for (const b of parsed.beliefs.slice(0, 3)) {
      if (!b || typeof b.text !== 'string' || !b.text.trim()) continue;
      const entry = await this.record({
        type: 'semantic',
        text: b.text,
        importance: b.importance ?? 3,
        user,
        provenance: Array.isArray(b.supports) ? b.supports : [],
        tags: ['reflection'],
      });
      created.push(entry);
    }

    return { beliefs: created, basis: `reflection_over_${recent.length}_episodic_memories`, generatedAt: Date.now() };
  }

  /* ---------- reporting ---------- */

  stats() {
    const all = this.store?.data?.memories ?? this.store?.listMemories?.('') ?? [];
    const total = all.length;
    const byType = {};
    for (const m of all) byType[m.type ?? 'episodic'] = (byType[m.type ?? 'episodic'] ?? 0) + 1;
    const superseded = all.filter((m) => m.supersededBy).length;
    return {
      totalMemories: total,
      activeMemories: total - superseded,
      superseded,
      byType,
      reflectionPressure: this._reflectionPressure,
      reflectionThreshold: this.reflectionThreshold,
    };
  }

  async consolidate({ user = 'anon' } = {}) {
    const now = Date.now();
    const memories = this.store.listMemories(user).filter((m) => !m.supersededBy);
    let merged = 0, decayed = 0, promoted = 0;

    for (const m of memories) {
      const ageDays = (now - m.createdAt) / 86_400_000;
      if (ageDays > 7 && (m.accessCount ?? 0) === 0 && (m.importance ?? 3) <= 2) { m.importance = Math.max(1, (m.importance ?? 3) - 1); decayed++; }
    }
    for (const m of memories) {
      if (m.type === 'episodic' && (m.accessCount ?? 0) >= 3 && (m.importance ?? 3) >= 3) {
        await this.record({ type: 'semantic', text: m.text, importance: m.importance, user, provenance: [m.id], tags: ['promoted'] });
        m.supersededBy = 'promoted';
        promoted++;
      }
    }
    const seen = new Set();
    for (const m of memories) {
      if (m.supersededBy || seen.has(m.id)) continue;
      for (const other of memories) {
        if (other.id === m.id || seen.has(other.id) || other.supersededBy) continue;
        if (cosine(Float32Array.from(m.vec ?? []), Float32Array.from(other.vec ?? [])) > 0.94) {
          other.supersededBy = m.id;
          seen.add(other.id);
          merged++;
        }
      }
      seen.add(m.id);
    }
    await this.store.save?.();
    return { merged, decayed, promoted };
  }
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }