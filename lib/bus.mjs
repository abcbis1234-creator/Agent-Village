export class Bus {
  constructor() {
    this.queues = new Map();
    this.waiters = new Map();
    this.subscribers = new Map();
    this.seq = 0;
  }

  send({ from, to, type, body, correlationId }) {
    const env = {
      id: crypto.randomUUID(),
      seq: ++this.seq,
      from, to, type, body,
      correlationId: correlationId ?? crypto.randomUUID(),
      ts: Date.now(),
    };
    for (const fn of this.subscribers.get(to) ?? []) fn(env);
    for (const fn of this.subscribers.get('*') ?? []) fn(env);

    const waiter = this.waiters.get(env.correlationId);
    if (waiter) {
      this.waiters.delete(env.correlationId);
      waiter.resolve(env);
    } else {
      const q = this.queues.get(to) ?? [];
      q.push(env);
      this.queues.set(to, q);
    }
    return env;
  }

  ask({ from, to, body, timeoutMs = 10_000, signal }) {
    const correlationId = crypto.randomUUID();
    this.send({ from, to, type: 'ask', body, correlationId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(correlationId); reject(new Error(`ask ${to} timeout`)); }, timeoutMs);
      signal?.addEventListener?.('abort', () => { clearTimeout(timer); this.waiters.delete(correlationId); reject(new Error('aborted')); });
      this.waiters.set(correlationId, { resolve: (env) => { clearTimeout(timer); resolve(env); } });
    });
  }

  tell({ from, to, body }) { return this.send({ from, to, type: 'tell', body }); }
  broadcast({ from, body }) { return this.send({ from, to: '*', type: 'broadcast', body }); }

  subscribe(to, fn) {
    const set = this.subscribers.get(to) ?? new Set();
    set.add(fn);
    this.subscribers.set(to, set);
    return () => set.delete(fn);
  }
}