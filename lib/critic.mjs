import { chatStreamWithFallback } from './llm.mjs';
import { extractJson } from './json.mjs';

export const LENSES = [
  { id: 'falsification', system: `Falsification lens. You are an adversarial reviewer. Find the single strongest reason the artifact is WRONG, incomplete, or misleading. Return ONLY JSON: {"fatal":boolean,"finding":"one sentence","evidence":"quote or ''","confidence":0.0-1.0}`, maxTokens: 250 },
  { id: 'callerVerification', system: `Caller Verification lens. Verify whether the artifact satisfies the ORIGINAL request. Return ONLY JSON: {"satisfies":boolean,"gaps":["..."],"confidence":0.0-1.0}`, maxTokens: 250 },
  { id: 'steelman', system: `Steelman lens. Construct the strongest case AGAINST the artifact. Return ONLY JSON: {"counterCase":"...","counterSucceeds":boolean,"confidence":0.0-1.0}`, maxTokens: 300 },
];

export class Critic {
  constructor({ store, defaultProvider = 'mock', independentProviders = ['mock'] } = {}) {
    this.store = store;
    this.defaultProvider = defaultProvider;
    this.independentProviders = independentProviders;
  }

  // Only providers that are actually usable are offered. The orchestrator
  // computes the list from configured credentials; standalone/tests default to
  // mock so no live provider is ever called by accident.
  pickProvider(builderProvider) {
    return this.independentProviders.find((p) => p !== builderProvider) ?? 'mock';
  }

  async review({ artifact, request, context = '', builderProvider, signal }) {
    const provider = this.pickProvider(builderProvider);
    const results = await Promise.all(LENSES.map((lens) =>
      this._runLens({ lens, artifact, request, context, provider, signal })
        .catch((e) => {
          if (e?.name === 'AbortError') throw e;
          return { lens: lens.id, error: e.message, confidence: 0 };
        })
    ));
    const verdict = this._synthesize(results, provider);

    // Persist the critique as procedural memory (Archivist contract). Best-effort.
    if (this.store?.addMemoryRecord) {
      try {
        await this.store.addMemoryRecord({
          id: crypto.randomUUID(),
          type: 'procedural',
          text: `Critique of "${String(request).slice(0, 80)}": ${verdict.summary}`,
          importance: verdict.overall === 'reject' ? 5 : 3,
          tags: ['critic', verdict.overall],
          user: 'system',
          provenance: results.map((r) => r.lens),
          createdAt: Date.now(),
          vec: [],
          accessCount: 0,
          confidence: verdict.confidence,
          supersededBy: null,
        });
      } catch { /* procedural memory is best-effort */ }
    }

    return verdict;
  }

  async _runLens({ lens, artifact, request, context, provider, signal }) {
    const user = `REQUEST:\n${request}\n\nCONTEXT:\n${context || '(none)'}\n\nARTIFACT:\n${artifact}`;
    // Failover chain: the picked provider first, then the remaining independent
    // providers, deduped. A lens that exhausts the chain yields an error result
    // which the synthesizer treats as low-confidence (never a silent reject).
    const chain = [...new Set([provider, ...this.independentProviders])].filter(Boolean);
    let text = '';
    try {
      for await (const { delta, done } of chatStreamWithFallback({ providers: chain, system: lens.system, messages: [{ role: 'user', content: user }], maxTokens: lens.maxTokens, signal })) {
        if (done) break; text += delta;
      }
    } catch (e) {
      // A cancelled run must not be converted into "all lenses passed".
      if (e?.name === 'AbortError') throw e;
      return { lens: lens.id, error: e.message, confidence: 0 };
    }
    const parsed = extractJson(text);
    if (!parsed) return { lens: lens.id, confidence: 0, error: 'unparseable' };
    return { lens: lens.id, ...parsed };
  }

  _synthesize(results, provider) {
    const findings = [];
    let reject = false;
    let conf = 0;
    for (const r of results) {
      conf = Math.max(conf, Number(r.confidence) || 0);
      if (r.lens === 'falsification' && r.fatal) { reject = true; findings.push({ lens: r.lens, fatal: true, finding: r.finding, evidence: r.evidence }); }
      if (r.lens === 'callerVerification' && r.satisfies === false) { reject = true; findings.push({ lens: r.lens, gaps: r.gaps }); }
      if (r.lens === 'steelman' && r.counterSucceeds) { reject = true; findings.push({ lens: r.lens, counterCase: r.counterCase }); }
    }
    const summary = reject
      ? findings.map((f) => f.finding ?? f.gaps?.[0] ?? f.counterCase).filter(Boolean).join('; ') || 'rejected by adversarial lens'
      : 'all three lenses passed';
    // Backward-compatible `issues` alias (strings) for existing consumers.
    const issues = findings
      .filter((f) => f.fatal || f.gaps || f.counterCase)
      .map((f) => f.finding ?? f.gaps?.join('; ') ?? f.counterCase)
      .filter(Boolean);

    return {
      overall: reject ? 'reject' : 'accept',
      summary,
      findings,
      issues,
      confidence: conf,
      calibrated: conf >= 0.7 ? 'high' : conf >= 0.4 ? 'medium' : 'low',
      provider,
      lenses: results.map((r) => r.lens),
    };
  }
}