import { chatStream } from './llm.mjs';
import { createHash } from 'node:crypto';

export const VERDICTS = { ALLOW: 'allow', ALLOW_LOGGED: 'allow_logged', REQUIRE_APPROVAL: 'require_approval', DENY: 'deny', QUARANTINE: 'quarantine' };

const DEFAULT_POLICY = {
  tools: {
    calculator: { risk: 'safe', schema: { expression: 'string' } },
    clock: { risk: 'safe', schema: {} },
    remember: { risk: 'safe', schema: { text: 'string' } },
    recall: { risk: 'safe', schema: { query: 'string', k: 'number?' } },
    sd_generate: { risk: 'guarded', schema: { prompt: 'string', width: 'number?', height: 'number?' }, maxPromptChars: 1000, requiresApproval: true },
    external_http: { risk: 'guarded', schema: { url: 'string' }, egressAllowlist: [], requiresApproval: true },
  },
  hardDenyPatterns: [/\.\.\//, /(?:;|\||&&|`|\$\()/, /(?:169\.254\.|127\.0\.0\.1|0\.0\.0\.0|::1)/],
};

export class SecurityReviewer {
  constructor({ store, policy = {} } = {}) {
    this.store = store;
    this.policy = merge(DEFAULT_POLICY, policy);
    this.capabilities = new Map();
  }

  mintCapability({ tool, scope = 'once', ttlMs = 60_000 }) {
    const token = crypto.randomUUID();
    this.capabilities.set(token, { tool, scope, expiresAt: Date.now() + ttlMs, singleUse: scope === 'once' });
    return token;
  }

  _consumeCapability(token, tool) {
    if (!token) return false;
    const cap = this.capabilities.get(token);
    if (!cap || cap.tool !== tool) return false;
    if (Date.now() > cap.expiresAt) { this.capabilities.delete(token); return false; }
    if (cap.singleUse) this.capabilities.delete(token);
    return true;
  }

  async gate({ tool, args, user = 'anon', capabilityToken, runId, signal, onEvent }) {
    const t0 = Date.now();
    const decision = { tool, args, user, runId, verdict: null, layer: null, reasons: [], ts: t0 };

    const l1 = this._l1(tool, args);
    decision.layer = 'L1';
    decision.reasons.push(...l1.reasons);
    if (l1.verdict === VERDICTS.DENY) {
      decision.verdict = VERDICTS.DENY;
      return this._finalize(decision, onEvent);
    }

    const spec = this.policy.tools[tool];
    if (spec?.requiresApproval) {
      if (!this._consumeCapability(capabilityToken, tool)) {
        decision.verdict = VERDICTS.REQUIRE_APPROVAL;
        decision.reasons.push('capability token missing or expired');
        return this._finalize(decision, onEvent);
      }
    }

    decision.verdict = spec?.risk === 'safe' ? VERDICTS.ALLOW : VERDICTS.ALLOW_LOGGED;
    return this._finalize(decision, onEvent);
  }

  _l1(tool, args) {
    const reasons = [];
    const spec = this.policy.tools[tool];
    if (!spec) return { verdict: VERDICTS.DENY, reasons: [`unknown tool: ${tool}`] };

    for (const [key, type] of Object.entries(spec.schema ?? {})) {
      const optional = type.endsWith('?');
      const base = type.replace(/\?$/, '');
      const val = args?.[key];
      if (val === undefined) { if (!optional) reasons.push(`missing: ${key}`); continue; }
      if (base === 'string' && typeof val !== 'string') reasons.push(`${key} must be string`);
      if (base === 'number' && typeof val !== 'number') reasons.push(`${key} must be number`);
    }
    for (const key of Object.keys(args ?? {})) {
      if (!(key in (spec.schema ?? {}))) reasons.push(`unexpected arg: ${key}`);
    }
    for (const [key, val] of Object.entries(args ?? {})) {
      if (typeof val !== 'string') continue;
      for (const re of this.policy.hardDenyPatterns) if (re.test(val)) reasons.push(`${key} matches denied pattern`);
    }
    if (spec.maxPromptChars && typeof args?.prompt === 'string' && args.prompt.length > spec.maxPromptChars) reasons.push('prompt too long');
    if (spec.egressAllowlist && typeof args?.url === 'string') {
      try {
        const u = new URL(args.url);
        const allowed = spec.egressAllowlist.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
        if (!allowed) reasons.push(`egress not allowlisted: ${u.hostname}`);
      } catch { reasons.push('invalid URL'); }
    }
    return { verdict: reasons.length ? VERDICTS.DENY : VERDICTS.ALLOW, reasons };
  }

  async _finalize(decision, onEvent) {
    const record = { ...decision, latencyMs: Date.now() - decision.ts, signature: null };
    record.signature = createHash('sha256').update(JSON.stringify({ ...record, signature: null })).digest('hex').slice(0, 32);
    onEvent?.({ type: 'security_decision', decision: record });
    return record;
  }
}

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return out;
}