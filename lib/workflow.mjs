export class Workflow {
  constructor({ name, nodes, edges = [], policy, budget, onEvent, onCheckpoint }) {
    this.name = name;
    this.nodes = nodes;
    this.edges = edges;
    this.policy = policy;
    this.budget = budget;
    this.onEvent = onEvent ?? (() => {});
    this.onCheckpoint = onCheckpoint ?? (() => {});
    this.controllers = new Map();
    this.completed = new Set();
    this.results = new Map();
    this.failed = null;
    this.suspended = null;
  }

  cancel(reason = 'cancelled') {
    if (this.failed) return;
    this.failed = reason;
    for (const c of this.controllers.values()) c.abort();
  }

  suspend(reason = 'suspended') {
    if (this.suspended) return;
    this.suspended = reason;
    this._emitCheckpoint();
    this.onEvent({ type: 'suspended', reason });
  }

  resume() {
    const was = Boolean(this.suspended);
    this.suspended = null;
    if (was) this.onEvent({ type: 'resumed' });
  }

  state() {
    return {
      name: this.name,
      completed: [...this.completed].sort(),
      results: Object.fromEntries(this.results),
      failed: this.failed ?? null,
      suspended: this.suspended ?? null,
      ts: Date.now(),
    };
  }

  _emitCheckpoint() {
    const s = this.state();
    this.onCheckpoint?.(s);
    this.onEvent?.({ type: 'checkpoint', ...s });
  }

  _deps(node) { return this.edges.filter((e) => e.to === node).map((e) => e.from); }

  async run({ checkpoint } = {}) {
    if (checkpoint) {
      for (const id of checkpoint.completed ?? []) this.completed.add(id);
      for (const [id, r] of Object.entries(checkpoint.results ?? {})) this.results.set(id, r);
      if (checkpoint.suspended != null) this.suspended = checkpoint.suspended;
    }
    const pending = new Set(this.nodes.map((n) => n.id));
    for (const id of this.completed) pending.delete(id);

    while (pending.size > 0) {
      if (this.failed) throw new Error(this.failed);
      if (this.suspended) break;
      const ready = [...pending].filter((id) => this._deps(id).every((d) => this.completed.has(d)));
      if (ready.length === 0) throw new Error(`deadlock: [${[...pending].join(',')}]`);

      await Promise.all(ready.map(async (id) => {
        if (this.suspended) return;
        const node = this.nodes.find((n) => n.id === id);
        const ac = new AbortController();
        this.controllers.set(id, ac);
        try {
          if (node.requiresApproval && this.policy) {
            const d = await this.policy.request({ nodeId: id, tool: node.tool, args: node.args, reason: node.reason });
            if (!d.approved) throw new Error(`approval denied: ${id}`);
          }
          this.budget?.spend('node_starts');
          this.onEvent({ type: 'node_start', nodeId: id });
          const result = await node.run({ signal: ac.signal, budget: this.budget, results: this.results });
          this.results.set(id, result);
          this.completed.add(id);
          pending.delete(id);
          this.onEvent({ type: 'node_end', nodeId: id, result });
          this._emitCheckpoint();
        } catch (e) {
          if (e.name === 'AbortError' || this.failed) return;
          this.onEvent({ type: 'node_error', nodeId: id, error: e.message });
          if (!node.optional) this.failed = e.message;
          pending.delete(id);
          this.completed.add(id);
          this._emitCheckpoint();
        } finally {
          this.controllers.delete(id);
        }
      }));
      this._emitCheckpoint();
    }
    this._emitCheckpoint();
    return Object.fromEntries(this.results);
  }
}
