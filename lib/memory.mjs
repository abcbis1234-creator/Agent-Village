const DIM = 384;

function hash32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function embed(text) {
  const v = new Float32Array(DIM);
  const tokens = String(text).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    const h1 = hash32(tok, 0x811c9dc5);
    const h2 = hash32(tok, 0xdeadbeef);
    const sign = (h1 & 1) ? 1 : -1;
    v[h1 % DIM] += sign;
    v[h2 % DIM] += sign * 0.5;
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export class VectorMemory {
  constructor(store) { this.store = store; }

  async add(text, tags = [], user = 'anon') {
    const vec = embed(text);
    const mem = {
      id: crypto.randomUUID(),
      text, tags, user,
      vec: Array.from(vec, (x) => Math.round(x * 1e4) / 1e4),
      createdAt: Date.now(),
    };
    await this.store.addMemoryRecord(mem);
    return mem;
  }

  search(query, { k = 5, minScore = 0.15, user = 'anon' } = {}) {
    const q = embed(query);
    const all = this.store.listMemories(user);
    return all
      .map((m) => ({ mem: m, score: cosine(q, Float32Array.from(m.vec ?? [])) }))
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}