// Critic v2 — structurally independent adversarial review.
//
// Research basis:
//   - Reviewer Independence Principle: never share the primary model's judgment,
//     scores, or conclusions with the reviewer before it forms its own assessment.
//     Anchoring collapses the value of cross-model review.
//   - Self-correction blind spot: LLMs correct identical errors when presented as
//     external input but fail on their own outputs. The Critic must see the artifact
//     as an external object, never as "my work".
//   - Cross-model review: each provider is a slice of cheese with holes; stacking
//     different providers means the holes rarely align. The Critic defaults to a
//     provider different from the Builder.
//   - Constitutional AI: a constitution of named principles produces actionable,
//     auditable critiques; a single "is this good?" prompt produces generic feedback.
//   - critic-orchestrator / Devil's Advocate: three adversaries in parallel
//     (falsification / caller-verification / steelman) beat one generic critic.
//   - LLM-as-judge noise: pairwise verdicts flip 11-14% on identical re-runs, so the
//     Critic reports calibrated confidence and takes the conservative verdict.

export const LENSES = {
  falsification: {
    id: 'falsification',
    name: 'Falsification',
    system: `You are an adversarial reviewer whose ONLY job is to falsify the artifact.
Find the single strongest reason this artifact is wrong, incomplete, or misleading.
If you cannot find a real flaw, say so explicitly — do not invent one.
Return ONLY JSON: {"fatal": boolean, "finding": "one-sentence flaw or 'none found'", "evidence": "quote or reference", "confidence": 0.0-1.0}`,
    maxTokens: 300,
  },
  callerVerification: {
    id: 'callerVerification',
    name: 'Caller Verification',
    system: `You verify whether the artifact actually satisfies the ORIGINAL request.
Compare the artifact to the request. Check: did it answer the actual question? Did it miss a constraint?
Return ONLY JSON: {"satisfies": boolean, "gaps": ["..."], "confidence": 0.0-1.0}`,
    maxTokens: 300,
  },
  steelman: {
    id: 'steelman',
    name: 'Steelman',
    system: `You are the strongest possible opponent of the artifact.
Construct the most compelling case AGAINST it. Then, and only then, state whether your own counter-case succeeds.
Return ONLY JSON: {"counterCase": "...", "counterSucceeds": boolean, "confidence": 0.0-1.0}`,
    maxTokens: 400,
  },
};

function extractJson(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export class Critic {
  constructor({ llm, store, defaultProvider = 'mock', independentProviders = ['openai', 'anthropic', 'ollama', 'mock'] } = {}) {
    this.llm = llm;
    this.store = store;
    this.defaultProvider = defaultProvider;
    this.independentProviders = independentProviders;
  }

  /**
   * Run the critic.
   *
   * IMPORTANT: `builderSelfAssessment` is deliberately NOT accepted. The Critic only
   * receives the artifact, the original request, and optional context. This enforces
   * the Reviewer Independence Principle at the API level, not in a prompt.
   */
  async review({ artifact, request, context = '', builderProvider, criticProvider, signal, onEvent } = {}) {
    const provider = criticProvider ?? this._chooseIndependentProvider(builderProvider);
    const lenses = Object.values(LENSES);

    onEvent?.({ type: 'critic_start', provider, lenses: lenses.map((l) => l.id) });

    const results = await Promise.all(
      lenses.map((lens) =>
        this._runLens({ lens, artifact, request, context, provider, signal })
          .catch((e) => ({ lens: lens.id, error: e.message, confidence: 0 }))
      )
    );

    const verdict = this._synthesize(results, builderProvider, provider);

    onEvent?.({ type: 'critic_end', verdict });

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
      } catch {
        /* procedural memory is best-effort; never fail the run for it */
      }
    }

    return verdict;
  }

  _chooseIndependentProvider(builderProvider) {
    // Cross-model by default: never let the builder grade its own work.
    const candidates = this.independentProviders.filter((p) => p !== builderProvider);
    return candidates[0] ?? 'mock';
  }

  async _runLens({ lens, artifact, request, context, provider, signal }) {
    const user = `ORIGINAL REQUEST:\n${request}\n\nCONTEXT:\n${context || '(none)'}\n\nARTIFACT TO REVIEW:\n${artifact}`;
    let text = '';
    for await (const { delta, done } of this.llm.chatStream({
      provider,
      system: `${lens.name} lens.\n\n${lens.system}`,
      messages: [{ role: 'user', content: user }],
      maxTokens: lens.maxTokens,
      signal,
    })) {
      if (done) break;
      text += delta;
    }
    const parsed = extractJson(text) ?? { confidence: 0, error: 'unparseable' };
    return { lens: lens.id, ...parsed, raw: text };
  }

  _synthesize(results, builderProvider, criticProvider) {
    const findings = [];
    let reject = false;
    let hardConfidence = 0;

    for (const r of results) {
      if (r.error) {
        findings.push({ lens: r.lens, note: `error: ${r.error}` });
        continue;
      }
      if (r.lens === 'falsification') {
        if (r.fatal) {
          reject = true;
          findings.push({ lens: r.lens, fatal: true, finding: r.finding, evidence: r.evidence });
        } else {
          findings.push({ lens: r.lens, fatal: false });
        }
        hardConfidence = Math.max(hardConfidence, r.confidence ?? 0);
      }
      if (r.lens === 'callerVerification') {
        if (!r.satisfies) {
          reject = true;
          findings.push({ lens: r.lens, gaps: r.gaps });
        } else {
          findings.push({ lens: r.lens, satisfies: true });
        }
        hardConfidence = Math.max(hardConfidence, r.confidence ?? 0);
      }
      if (r.lens === 'steelman') {
        if (r.counterSucceeds) {
          reject = true;
          findings.push({ lens: r.lens, counterCase: r.counterCase });
        } else {
          findings.push({ lens: r.lens, counterSucceeds: false });
        }
        hardConfidence = Math.max(hardConfidence, r.confidence ?? 0);
      }
    }

    const overall = reject ? 'reject' : 'accept';
    const summary = reject
      ? findings
          .filter((f) => f.fatal || f.gaps || f.counterCase)
          .map((f) => f.finding ?? f.gaps?.[0] ?? f.counterCase)
          .filter(Boolean)
          .join('; ') || 'rejected by adversarial lens'
      : 'all three lenses passed';

    // Backward-compatible `issues` alias (strings) for existing consumers/tests.
    const issues = findings
      .filter((f) => f.fatal || f.gaps || f.counterCase)
      .map((f) => f.finding ?? f.gaps?.join('; ') ?? f.counterCase)
      .filter(Boolean);

    return {
      overall,
      summary,
      findings,
      issues,
      confidence: Math.round(hardConfidence * 100) / 100,
      calibrated: hardConfidence >= 0.7 ? 'high' : hardConfidence >= 0.4 ? 'medium' : 'low',
      lenses: results.map((r) => r.lens),
      providerIndependent: builderProvider ? builderProvider !== criticProvider : true,
      builderProvider: builderProvider ?? null,
      criticProvider,
      reviewedAt: Date.now(),
    };
  }
}