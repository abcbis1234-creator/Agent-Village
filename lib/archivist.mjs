import { embed, cosine } from './memory.mjs';

const TYPES = ['episodic', 'semantic', 'procedural', 'core'];

export class Archivist {
  constructor(store, opts = {}) {
    this.store = store;
    this.reflectionThreshold = opts.reflectionThreshold ?? 30;
    this.decayHalfLifeDays = opts.decayHalfLifeDays ?? 30;
    this._reflectionPressure = 0;
  }

  async record({ type = 'episodic', text, importance = 3, tags = [], user = 'anon', provenance = [], confidence = 1 }) {
    if (!TYPES.includes(type)) throw new Error(`unknown type: ${type}`);
    const vec = embed(text);

    const existing = this.store.listMemories(user);
    for (const m of existing) {
      if (m.supersededBy) continue;
      if (m.type === type && cosine(vec, Float32Array.from(m.vec ?? [])) > 0.96) return m;
    }

    const entry = {
      id: crypto.randomUUID(), type, text: String(text),
      importance: clamp(importance, 1, 5), tags, user, provenance,
      createdAt: Date.now(), lastAccessedAt: Date.now(), accessCount: 0,
      confidence, supersededBy: null,
      vec: Array.from(vec, (x) => Math.round(x * 1e4) / 1e4),
    };
    await this.store.addMemoryRecord(entry);
    this._reflectionPressure += entry.importance;
    return entry;
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