// Critic — Adversarial Review implementation.
//
// Research basis:
//   - MAST failure mode: "every LLM says looks good to me" — needs at least one
//     deterministic/non-LLM check (Verifier) AND one subjective challenger (Critic)
//   - Blind spot diversity: Critic must run on different prompts/perspective than
//     Builder and Verifier, otherwise all three share the same failure modes
//   - Red teaming: Critic's job is to break the proposed answer, not validate it
//   - Severity-weighted issues: not all criticisms are equal; critical ones block
//
// The Critic does not verify facts (that's the Verifier). It challenges:
//   - Assumptions made without evidence
//   - Overconfidence in uncertain claims
//   - Missing considerations / unasked questions
//   - Weak reasoning chains
//   - Alternative interpretations the Builder may have missed

export function critique({ mission, toolResults, verifyResult, synthesizeResult, builderPlan }) {
  const issues = [];
  const alternatives = [];

  // ---------- 1. Assumption checking ----------
  // Flag claims made without tool evidence.
  const unsupportedClaims = [];
  const summary = String(synthesizeResult?.summary ?? '');
  if (summary && !toolResults || Object.keys(toolResults ?? {}).length === 0) {
    unsupportedClaims.push('No tool evidence was gathered; summary is based on reasoning alone');
  }
  if (unsupportedClaims.length > 0) {
    issues.push({
      id: 'unsupported_claims',
      severity: 'medium',
      category: 'assumption',
      message: 'Summary contains claims without supporting tool evidence',
      evidence: unsupportedClaims,
      suggestion: 'Run at least one tool to ground the answer, or mark the answer as unverified.',
    });
  }

  // ---------- 2. Overconfidence detection ----------
  // Flag high-confidence language when verification failed or was weak.
  const confidenceWords = ['definitely', 'certainly', 'obviously', 'clearly', 'always', 'never', 'guaranteed'];
  const confidentLanguage = confidenceWords.filter((w) => summary.toLowerCase().includes(w));
  const verificationFailed = verifyResult && !verifyResult.passed;
  if (confidentLanguage.length > 0 && (verificationFailed || Object.keys(toolResults ?? {}).length === 0)) {
    issues.push({
      id: 'overconfidence',
      severity: 'high',
      category: 'calibration',
      message: `Uses confident language (${confidentLanguage.join(', ')}) without supporting verification`,
      evidence: confidentLanguage,
      suggestion: 'Downgrade confidence language or run verification before asserting.',
    });
  }

  // ---------- 3. Missing considerations ----------
  // Check if the mission asks for something the tools didn't cover.
  const missionLower = String(mission ?? '').toLowerCase();
  const consideredTools = Object.keys(toolResults ?? {});

  if (missionLower.includes('time') && !consideredTools.includes('clock')) {
    issues.push({
      id: 'missing_time_tool',
      severity: 'medium',
      category: 'coverage',
      message: 'Mission asks about time but clock tool was not used',
      evidence: ['mission mentions time', 'clock tool not in results'],
      suggestion: 'Call clock tool to ground temporal claims.',
    });
  }

  if (missionLower.includes('calculate') || missionLower.includes('compute') || missionLower.includes('math')) {
    if (!consideredTools.includes('calculator')) {
      issues.push({
        id: 'missing_calculator_tool',
        severity: 'high',
        category: 'coverage',
        message: 'Mission asks for calculation but calculator tool was not used',
        evidence: ['mission mentions calculation', 'calculator tool not in results'],
        suggestion: 'Use calculator tool for arithmetic instead of mental math.',
      });
    }
  }

  // ---------- 4. Weak reasoning chains ----------
  // Flag when Builder skipped steps or results are suspiciously short.
  const shortResults = Object.entries(toolResults ?? {}).filter(
    ([, v]) => String(v).trim().length < 10
  );
  if (shortResults.length > 0) {
    issues.push({
      id: 'thin_results',
      severity: 'low',
      category: 'depth',
      message: `${shortResults.length} tool(s) returned suspiciously short results`,
      evidence: shortResults.map(([t]) => t),
      suggestion: 'Re-run with more context or verify results are complete.',
    });
  }

  // ---------- 5. Alternative proposals ----------
  // If the plan only used one tool, suggest alternatives.
  if (consideredTools.length === 1 && consideredTools[0] === 'calculator') {
    alternatives.push({
      id: 'alternative_memory',
      message: 'Consider using remember/recall tools if this calculation relates to past context',
      confidence: 'medium',
    });
  }
  if (consideredTools.length === 0) {
    alternatives.push({
      id: 'alternative_tools',
      message: 'No tools were used; consider if clock, calculator, or memory tools could add evidence',
      confidence: 'high',
    });
  }

  // ---------- 6. Verifier disagreement ----------
  // If Verifier passed but Critic found issues, flag the tension.
  if (verifyResult && verifyResult.passed && issues.length > 0) {
    issues.push({
      id: 'verifier_critic_disagreement',
      severity: 'medium',
      category: 'review_disagreement',
      message: 'Verifier passed but Critic identified issues — review may be too lenient',
      evidence: issues.map((i) => i.message),
      suggestion: 'Re-examine with stricter criteria or additional tool evidence.',
    });
  }

  // ---------- Overall assessment ----------
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const high = issues.filter((i) => i.severity === 'high').length;
  const medium = issues.filter((i) => i.severity === 'medium').length;

  let overall;
  if (critical > 0) overall = 'critical';
  else if (high > 0) overall = 'high';
  else if (medium > 0) overall = 'medium';
  else if (issues.length > 0) overall = 'low';
  else overall = 'pass';

  return {
    overall,
    issueCount: issues.length,
    criticalCount: critical,
    highCount: high,
    mediumCount: medium,
    issues,
    alternatives,
    canProceed: critical === 0 && high === 0,
    reviewedAt: Date.now(),
  };
}

// Convenience: quick sanity check without full orchestration context.
export function quickCritique(mission, result) {
  return critique({
    mission,
    toolResults: {},
    verifyResult: { passed: false },
    synthesizeResult: { summary: result },
    builderPlan: { steps: [] },
  });
}
