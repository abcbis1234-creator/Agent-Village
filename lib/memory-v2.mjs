// Archivist v2 — typed, append-only memory with reflection and consolidation.
//
// Research basis:
//   - Smallville MemoryStream (Park et al. 2023): append-only store, retrieval scored by
//     recency × importance × relevance, and a poignancy-pressure reflection trigger
//     (importance of each new memory decrements a countdown; reflection fires at zero).
//   - MIRIX / ZenBrain / Agent Brain: typed memory layers (episodic / semantic /
//     procedural / core). Procedural memory is the layer most LLM-era systems omit.
//   - Agent Brain: deduplication guard, hybrid search, nightly "Dream Cycle"
//     (decay / promote / merge). Consolidation is optional and measurable — it can
//     lose signal, so it is never forced inline.
//   - Letta / MemGPT: core / recall / archival tiers.
//   - Contradiction handling: memories are never overwritten; a corrected memory gets
//     `supersededBy` set and a new record is appended (bi-temporal style).

import { embed, cosine } from './memory.mjs';

export const TYPES = ['episodic', 'semantic', 'procedural', 'core'];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,
  /Bearer\s+[A-Za-z0-9\-_.+/=]{20,}/i,
  /api[_-]?key/i,
  /password\s*[:=]/i,
  /secret\s*[:=]/i,
  /-----BEGIN.*PRIVATE KEY-----/,
];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function toVec(m) {
  if (Array.isArray(m.vec) && m.vec.length) return Float32Array.from(m.vec);
  return embed(String(m.text ?? ''));
}

function extractJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export class Archivist {
  constructor(store, options = {}) {
    this.store = store;
    this.reflectionThreshold = options.reflectionThreshold ?? 30; // Smallville importance_trigger_max
    this.decayHalfLifeDays = options.decayHalfLifeDays ?? 30;
    this.maxMemories = options.maxMemories ?? 5000;
    this.dreamEnabled = options.dreamEnabled ?? true;
    this.dreamCooldownMs = options.dreamCooldownMs ?? 6 * 60 * 60 * 1000;
    this._reflectionPressure = 0;
    this._lastDream = 0;
  }

  /* ---------- write path (append-only) ---------- */

  async record({ type = 'episodic', text, importance = 3, tags = [], user = 'anon', provenance = [] } = {}) {
    if (!TYPES.includes(type)) throw new Error(`unknown memory type: ${type}`);
    const cleanText = String(text ?? '').trim();
    if (!cleanText) throw new Error('text is required');

    const entry = {
      id: crypto.randomUUID(),
      type,
      text: cleanText,
      importance: clamp(Number(importance) || 3, 1, 5),
      tags,
      user,
      provenance,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 0,
      confidence: 1.0,
      supersededBy: null,
      vec: Array.from(embed(cleanText), (x) => Math.round(x * 1e4) / 1e4),
    };

    // Deduplication guard (Agent Brain): reject near-identical memories of the same type.
    const existing = this.store.listMemories(user) ?? [];
    for (const m of existing) {
      if (m.supersededBy) continue;
      if (m.type === type && cosine(toVec(entry), toVec(m)) > 0.96) {
        m.lastAccessedAt = Date.now();
        m.accessCount = (m.accessCount ?? 0) + 1;
        return m; // idempotent: same memory, bumped
      }
    }

    // Secret scan: durable memory must never store credentials.
    for (const re of SECRET_PATTERNS) {
      if (re.test(cleanText)) {
        const err = new Error('refusing to store a secret in memory');
        err.code = 'SECRET_IN_MEMORY';
        throw err;
      }
    }

    await this.store.addMemoryRecord(entry);
    if (this.store.data?.memories?.length > this.maxMemories) {
      this.store.data.memories.splice(0, this.store.data.memories.length - this.maxMemories);
    }

    // Smallville reflection trigger: poignancy pressure.
    this._reflectionPressure += entry.importance;
    if (this._reflectionPressure >= this.reflectionThreshold) {
      this._reflectionPressure = 0;
      await this.store.queueReflection?.(user);
      entry.reflectionQueued = true;
    }

    return entry;
  }

  /* ---------- retrieval: recency × importance × relevance ---------- */

  retrieve(query, { user = 'anon', k = 6, types = null, minScore = 0.12 } = {}) {
    const now = Date.now();
    const qVec = embed(query);
    const all = (this.store.listMemories(user) ?? []).filter((m) => !m.supersededBy);
    const pool = types ? all.filter((m) => types.includes(m.type)) : all;

    const scored = pool.map((m) => {
      const relevance = cosine(qVec, toVec(m));
      const ageDays = (now - (m.createdAt ?? now)) / 86_400_000;
      const recency = Math.exp(-ageDays / this.decayHalfLifeDays);
      const importance = (m.importance ?? 3) / 5;
      const score = 0.5 * relevance + 0.3 * recency + 0.2 * importance;
      return { memory: m, score, relevance, recency, importance };
    });

    const hits = scored
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    for (const h of hits) {
      h.memory.lastAccessedAt = now;
      h.memory.accessCount = (h.memory.accessCount ?? 0) + 1;
    }

    return hits;
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

    const user2 = recent.map((m) => `[${m.id}] (importance ${m.importance}) ${m.text}`).join('\n');

    let text = '';
    for await (const { delta, done } of llm.chatStream({
      provider,
      system,
      messages: [{ role: 'user', content: user2 }],
      maxTokens: 300,
    })) {
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

    return {
      beliefs: created,
      basis: `reflection_over_${recent.length}_episodic_memories`,
      generatedAt: Date.now(),
    };
  }

  /* ---------- consolidation ("Dream Cycle") ---------- */

  async dreamCycle({ user = 'anon' } = {}) {
    if (!this.dreamEnabled) return { skipped: true, reason: 'disabled' };
    const now = Date.now();
    if (this._lastDream && now - this._lastDream < this.dreamCooldownMs) {
      return { skipped: true, reason: 'cooldown', nextEligibleAt: this._lastDream + this.dreamCooldownMs };
    }
    this._lastDream = now;

    const memories = (this.store.listMemories(user) ?? []).filter((m) => !m.supersededBy);
    let merged = 0;
    let decayed = 0;
    let promoted = 0;

    // Phase 1 — decay: low-access, low-importance, old memories lose weight.
    for (const m of memories) {
      const ageDays = (now - (m.createdAt ?? now)) / 86_400_000;
      const shouldDecay = ageDays > 7 && (m.accessCount ?? 0) === 0 && (m.importance ?? 3) <= 2;
      if (shouldDecay) {
        m.importance = Math.max(1, (m.importance ?? 3) - 1);
        m.lastAccessedAt = now;
        decayed++;
      }
    }

    // Phase 2 — promote: frequently accessed episodic memories become semantic.
    for (const m of memories) {
      if (m.supersededBy) continue;
      if (m.type === 'episodic' && (m.accessCount ?? 0) >= 3 && (m.importance ?? 3) >= 3) {
        await this.record({
          type: 'semantic',
          text: m.text,
          importance: m.importance ?? 3,
          user,
          provenance: [m.id],
          tags: ['promoted'],
        });
        m.supersededBy = 'promoted-to-semantic';
        promoted++;
      }
    }

    // Phase 3 — merge: near-duplicate memories collapse into the higher-importance one.
    const seen = new Set();
    for (const m of memories) {
      if (m.supersededBy || seen.has(m.id)) continue;
      for (const other of memories) {
        if (other.id === m.id || seen.has(other.id) || other.supersededBy) continue;
        if (cosine(toVec(m), toVec(other)) > 0.94) {
          m.importance = Math.max(m.importance ?? 3, other.importance ?? 3);
          m.accessCount = (m.accessCount ?? 0) + (other.accessCount ?? 0);
          other.supersededBy = m.id;
          seen.add(other.id);
          merged++;
        }
      }
      seen.add(m.id);
    }

    await this.store.save?.();
    return { merged, decayed, promoted, at: now };
  }

  /* ---------- contradiction handling ---------- */

  async correct(memoryId, { correction, user = 'anon' } = {}) {
    const target = (this.store.listMemories(user) ?? []).find((m) => m.id === memoryId);
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
}