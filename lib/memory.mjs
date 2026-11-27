import { checkContent, CONTEXTS } from './security.mjs';

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
  // Legacy memories may have no vector (or a different dimension). Treat that
  // as zero similarity instead of letting `undefined` poison the score with
  // NaN, which would make the record invisible to retrieval forever.
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// BM25 catches what hashed embeddings lose: exact names, IDs, rare tokens.
// Hashing collisions and normalization can make "Zephyr" look like an
// unrelated word, while a lexical index keeps the literal term intact.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function tokenize(text) {
  return String(text ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function bm25Scores(query, documents) {
  const qTokens = tokenize(query);
  const docs = documents.map((d) => tokenize(d));
  const n = docs.length;
  if (n === 0 || qTokens.length === 0) return Array.from({ length: n }, () => 0);

  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / n || 1;
  const df = new Map();
  for (const term of new Set(qTokens)) {
    let count = 0;
    for (const d of docs) if (d.includes(term)) count++;
    df.set(term, count);
  }

  return docs.map((doc) => {
    const tf = new Map();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of qTokens) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const docsWithTerm = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
      const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (doc.length / avgdl));
      score += idf * ((f * (BM25_K1 + 1)) / denom);
    }
    return score;
  });
}

function normalizeScores(scores) {
  const max = Math.max(0, ...scores);
  return max > 0 ? scores.map((s) => Math.max(0, s) / max) : scores.map(() => 0);
}

// Hybrid score: semantic similarity plus normalized lexical relevance. The
// lexical share is what rescues exact/rare terms; the vector share handles
// paraphrase. Both live in [0, 1] so the blend is comparable across stores.
export function hybridScores(query, documents, vectors) {
  const lexical = normalizeScores(bm25Scores(query, documents));
  const q = embed(query);
  return documents.map((_, i) => {
    const semantic = Math.max(0, cosine(q, Float32Array.from(vectors[i] ?? [])));
    return { score: 0.65 * semantic + 0.35 * lexical[i], semantic, lexical: lexical[i] };
  });
}

export class VectorMemory {
  constructor(store) { this.store = store; }

  async add(text, tags = [], user = 'anon') {
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('text is required');
    // This is the write path behind /api/knowledge and /api/feedback, not just
    // the `remember` tool. Apply the same memory-write guard here so a direct
    // API call cannot bypass it and persist a credential or hidden payload.
    const guard = checkContent(clean, { context: CONTEXTS.MEMORY_WRITE });
    if (guard.severity === 'critical' || guard.severity === 'high') {
      const err = new Error('refusing to store unsafe content in memory');
      err.code = 'UNSAFE_MEMORY';
      err.status = 422;
      err.findings = guard.findings;
      throw err;
    }
    const vec = embed(clean);
    const mem = {
      id: crypto.randomUUID(),
      text: clean, tags, user,
      vec: Array.from(vec, (x) => Math.round(x * 1e4) / 1e4),
      createdAt: Date.now(),
    };
    await this.store.addMemoryRecord(mem);
    return mem;
  }

  search(query, { k = 5, minScore = 0.15, user = 'anon' } = {}) {
    const all = this.store.listMemories(user);
    const scores = hybridScores(query, all.map((m) => m.text ?? ''), all.map((m) => m.vec ?? []));
    return all
      .map((m, i) => ({ mem: m, ...scores[i] }))
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score || b.lexical - a.lexical)
      .slice(0, k);
  }
}