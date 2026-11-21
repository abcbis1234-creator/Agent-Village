import { chatStream } from './llm.mjs';

const LENSES = [
  { id: 'falsification', system: `You are an adversarial reviewer. Find the single strongest reason the artifact is WRONG, incomplete, or misleading. Return ONLY JSON: {"fatal":boolean,"finding":"one sentence","evidence":"quote or ''","confidence":0.0-1.0}`, maxTokens: 250 },
  { id: 'callerVerification', system: `Verify whether the artifact satisfies the ORIGINAL request. Return ONLY JSON: {"satisfies":boolean,"gaps":["..."],"confidence":0.0-1.0}`, maxTokens: 250 },
  { id: 'steelman', system: `Construct the strongest case AGAINST the artifact. Return ONLY JSON: {"counterCase":"...","counterSucceeds":boolean,"confidence":0.0-1.0}`, maxTokens: 300 },
];

export class Critic {
  constructor({ store, defaultProvider = 'mock' } = {}) {
    this.store = store;
    this.defaultProvider = defaultProvider;
  }

  pickProvider(builderProvider) {
    return ['openai', 'anthropic', 'ollama', 'mock'].find((p) => p !== builderProvider) ?? 'mock';
  }

  async review({ artifact, request, context = '', builderProvider, signal }) {
    const provider = this.pickProvider(builderProvider);
    const results = await Promise.all(LENSES.map((lens) =>
      this._runLens({ lens, artifact, request, context, provider, signal })
        .catch((e) => ({ lens: lens.id, error: e.message, confidence: 0 }))
    ));
    return this._synthesize(results, provider);
  }

  async _runLens({ lens, artifact, request, context, provider, signal }) {
    const user = `REQUEST:\n${request}\n\nCONTEXT:\n${context || '(none)'}\n\nARTIFACT:\n${artifact}`;
    let text = '';
    try {
      for await (const { delta, done } of chatStream({ provider, system: lens.system, messages: [{ role: 'user', content: user }], maxTokens: lens.maxTokens, signal })) {
        if (done) break; text += delta;
      }
    } catch (e) { return { lens: lens.id, error: e.message, confidence: 0 }; }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { lens: lens.id, confidence: 0, error: 'unparseable' };
    try { return { lens: lens.id, ...JSON.parse(m[0]) }; }
    catch { return { lens: lens.id, confidence: 0, error: 'unparseable' }; }
  }

  _synthesize(results, provider) {
    const findings = [];
    let reject = false;
    let conf = 0;
    for (const r of results) {
      conf = Math.max(conf, r.confidence ?? 0);
      if (r.lens === 'falsification' && r.fatal) { reject = true; findings.push({ lens: r.lens, finding: r.finding, evidence: r.evidence }); }
      if (r.lens === 'callerVerification' && r.satisfies === false) { reject = true; findings.push({ lens: r.lens, gaps: r.gaps }); }
      if (r.lens === 'steelman' && r.counterSucceeds) { reject = true; findings.push({ lens: r.lens, counterCase: r.counterCase }); }
    }
    return {
      overall: reject ? 'reject' : 'accept',
      findings, confidence: conf,
      calibrated: conf >= 0.7 ? 'high' : conf >= 0.4 ? 'medium' : 'low',
      provider,
      lenses: results.map((r) => r.lens),
    };
  }
}