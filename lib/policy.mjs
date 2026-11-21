const RISK = {
  calculator: 'safe',
  clock: 'safe',
  remember: 'safe',
  recall: 'safe',
  sd_generate: 'guarded',
  external_http: 'guarded',
};

export class ApprovalQueue {
  constructor({ autoApproveSafe = true } = {}) {
    this.autoApproveSafe = autoApproveSafe;
    this.pending = new Map();
  }

  riskOf(tool) { return RISK[tool] ?? 'guarded'; }

  request({ nodeId, tool, args, reason }) {
    const risk = this.riskOf(tool);
    if (risk === 'safe' && this.autoApproveSafe) {
      return Promise.resolve({ approved: true, auto: true, risk });
    }
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, { id, nodeId, tool, args, reason, risk, resolve, createdAt: Date.now() });
    });
  }

  list() {
    return [...this.pending.values()].map(({ resolve, ...rest }) => rest);
  }

  decide(id, { approved, reason }) {
    const req = this.pending.get(id);
    if (!req) return false;
    this.pending.delete(id);
    req.resolve({ approved: Boolean(approved), auto: false, risk: req.risk, reason });
    return true;
  }
}
