const DEFAULT_CAPS = {
  tokens: 20_000,
  cost: 0.5,
  latencyMs: 120_000,
  node_starts: 100,
  toolCalls: 50,
  llm_calls: 100,
};

export class Budget {
  constructor(caps = {}) {
    this.caps = { ...DEFAULT_CAPS, ...caps };
    this.used = { tokens: 0, cost: 0, node_starts: 0, toolCalls: 0, llm_calls: 0 };
    this.startedAt = Date.now();
  }
  check() {
    const elapsed = Date.now() - this.startedAt;
    if (elapsed > this.caps.latencyMs) throw new Error(`latency budget exceeded`);
    for (const k of ['tokens', 'cost', 'node_starts', 'toolCalls', 'llm_calls']) {
      if (this.used[k] > this.caps[k]) throw new Error(`${k} budget exceeded (${this.used[k]} > ${this.caps[k]})`);
    }
  }
  spend(kind, amount = 1) {
    if (kind === 'cost') this.used.cost += amount;
    else this.used[kind] = (this.used[kind] ?? 0) + amount;
    this.check();
  }
  snapshot() {
    return { caps: { ...this.caps }, used: { ...this.used }, elapsedMs: Date.now() - this.startedAt };
  }
}