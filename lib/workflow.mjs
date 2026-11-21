import { Budget } from './budget.mjs';
import { ApprovalQueue } from './policy.mjs';

export class Workflow {
  constructor({ name, nodes, edges = [], policy, budget, onEvent }) {
    this.name = name;
    this.nodes = nodes;
    this.edges = edges;
    this.policy = policy;
    this.budget = budget ?? new Budget();
    this.onEvent = onEvent ?? (() => {});
    this.controllers = new Map();
    this.completed = new Set();
    this.results = new Map();
    this.failed = null;
  }

  cancel(reason = 'cancelled') {
    if (this.failed) return;
    this.failed = reason;
    for (const c of this.controllers.values()) c.abort();
  }

  _emit(evt) { this.onEvent(evt); }

  _deps(node) {
    return this.edges.filter((e) => e.to === node).map((e) => e.from);
  }

  async run({ checkpoint, onCheckpoint } = {}) {
    if (checkpoint) {
      for (const id of checkpoint.completed ?? []) this.completed.add(id);
      for (const [id, r] of Object.entries(checkpoint.results ?? {})) this.results.set(id, r);
    }

    const pending = new Set(this.nodes.map((n) => n.id));
    for (const id of this.completed) pending.delete(id);

    while (pending.size > 0) {
      if (this.failed) throw new Error(this.failed);

      const ready = [...pending].filter((id) =>
        this._deps(id).every((d) => this.completed.has(d))
      );
      if (ready.length === 0) {
        throw new Error(`deadlock: pending nodes [${[...pending].join(',')}] have unmet dependencies`);
      }

      await Promise.all(ready.map(async (id) => {
        const node = this.nodes.find((n) => n.id === id);
        const ac = new AbortController();
        this.controllers.set(id, ac);

        try {
          if (node.requiresApproval) {
            const decision = await this.policy.request({
              nodeId: id,
              tool: node.tool,
              args: node.args,
              reason: node.reason,
            });
            if (!decision.approved) {
              throw new Error(`approval denied for ${id}: ${decision.reason ?? 'no reason'}`);
            }
          }

          this.budget.spend('node_starts');
          this._emit({ type: 'node_start', nodeId: id });

          const result = await node.run({ signal: ac.signal, budget: this.budget, results: this.results });
          this.results.set(id, result);
          this.completed.add(id);
          pending.delete(id);
          this._emit({ type: 'node_end', nodeId: id, result });
        } catch (e) {
          if (e.name === 'AbortError' || this.failed) return;
          this._emit({ type: 'node_error', nodeId: id, error: e.message });
          if (!node.optional) {
            this.failed = e.message;
          }
          pending.delete(id);
          this.completed.add(id);
        } finally {
          this.controllers.delete(id);
          await onCheckpoint?.({
            completed: [...this.completed],
            results: Object.fromEntries(this.results),
          });
        }
      }));

      if (this.failed) throw new Error(this.failed);
    }

    return Object.fromEntries(this.results);
  }
}
