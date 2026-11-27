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

    // A waiter belongs to the asker and is resolved only by a message
    // addressed back to it. Without the `to` check the outbound ask itself
    // (same correlationId, addressed to the responder) would resolve its own
    // promise before the responder ever saw it.
    const waiter = this.waiters.get(env.correlationId);
    if (waiter && waiter.to === env.to) {
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
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.delete(correlationId);
        signal?.removeEventListener?.('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`ask ${to} timeout`));
      }, timeoutMs);
      // Register the waiter BEFORE sending: a subscriber may answer
      // synchronously, and the old order made that reply land in the queue
      // while the requester still waited for a timeout.
      this.waiters.set(correlationId, {
        to: from,
        resolve: (env) => { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); resolve(env); },
      });
      signal?.addEventListener?.('abort', onAbort, { once: true });
      this.send({ from, to, type: 'ask', body, correlationId });
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