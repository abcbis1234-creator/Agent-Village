export class Bus {
  constructor() {
    this.queues = new Map();
    this.waiters = new Map();
    this.subscribers = new Map();
    this.seq = 0;
  }

  _key(to) { return to; }

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
      const q = this.queues.get(this._key(to)) ?? [];
      q.push(env);
      this.queues.set(this._key(to), q);
    }
    return env;
  }

  async ask({ from, to, body, timeoutMs = 10_000, signal }) {
    const correlationId = crypto.randomUUID();
    const envelope = this.send({ from, to, type: 'ask', body, correlationId });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(correlationId);
        reject(new Error(`ask ${to} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          this.waiters.delete(correlationId);
          reject(new Error('ask aborted'));
        };
        signal.addEventListener('abort', onAbort);
      }
      this.waiters.set(correlationId, {
        resolve: (env) => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); resolve(env); },
      });
      for (const fn of this.subscribers.get('*') ?? []) fn(envelope);
    });
  }

  tell({ from, to, body }) { return this.send({ from, to, type: 'tell', body }); }
  delegate({ from, to, body }) { return this.send({ from, to, type: 'delegate', body }); }
  broadcast({ from, body }) { return this.send({ from, to: '*', type: 'broadcast', body }); }

  subscribe(to, fn) {
    const set = this.subscribers.get(to) ?? new Set();
    set.add(fn);
    this.subscribers.set(to, set);
    return () => set.delete(fn);
  }

  drain(to) {
    const q = this.queues.get(this._key(to)) ?? [];
    this.queues.delete(this._key(to));
    return q;
  }
}
