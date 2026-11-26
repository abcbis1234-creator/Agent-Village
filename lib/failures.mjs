// Shared failure taxonomy (EVAL-053). One vocabulary for runtime errors, eval
// failures, and operator triage. Keep codes stable: dashboards and tests may
// branch on them even when human-readable messages change.

export const FAILURE_CODES = {
  PLAN_INVALID: { category: 'planning', retryable: true, description: 'plan is missing or malformed' },
  PLAN_EMPTY: { category: 'planning', retryable: true, description: 'plan produced no executable steps' },
  GATE_FAILED: { category: 'planning', retryable: true, description: 'an explicit phase gate rejected the handoff' },
  TOOL_UNKNOWN: { category: 'tool', retryable: false, description: 'the plan named a tool that is not registered' },
  TOOL_FAILED: { category: 'tool', retryable: true, description: 'a tool call raised an error' },
  TOOL_TIMEOUT: { category: 'tool', retryable: true, description: 'a tool call exceeded its time budget' },
  TOOL_DENIED: { category: 'safety', retryable: false, description: 'the security gate denied a tool call' },
  TOOL_APPROVAL: { category: 'safety', retryable: true, description: 'the tool requires a capability/approval token' },
  RETRIEVAL_FAILED: { category: 'retrieval', retryable: true, description: 'memory or research retrieval failed' },
  RETRIEVAL_EMPTY: { category: 'retrieval', retryable: true, description: 'retrieval returned no usable evidence' },
  FORMAT_INVALID_JSON: { category: 'formatting', retryable: true, description: 'model output was not valid JSON' },
  FORMAT_EMPTY_OUTPUT: { category: 'formatting', retryable: true, description: 'model returned no usable text' },
  SAFETY_DENIED: { category: 'safety', retryable: false, description: 'content was denied by the safety review' },
  SAFETY_QUARANTINE: { category: 'safety', retryable: false, description: 'tool output was quarantined' },
  PROVIDER_ERROR: { category: 'infra', retryable: true, description: 'the model provider failed' },
  BUDGET_EXCEEDED: { category: 'infra', retryable: false, description: 'a token/cost/latency budget was exhausted' },
  CANCELLED: { category: 'infra', retryable: true, description: 'the run was cancelled' },
  INTERRUPTED: { category: 'infra', retryable: true, description: 'the run was interrupted by a restart' },
  INTERNAL: { category: 'infra', retryable: false, description: 'an unexpected internal error occurred' },
};

const CATEGORIES = new Set(['planning', 'tool', 'retrieval', 'formatting', 'safety', 'infra']);

export function classifyFailure(input = {}) {
  const message = String(input.message ?? input.error ?? input.detail ?? '');
  const lower = message.toLowerCase();
  const where = String(input.where ?? input.phase ?? '').toLowerCase();
  const eventType = String(input.type ?? '').toLowerCase();
  const explicit = typeof input.code === 'string' ? input.code.toUpperCase() : '';

  if (explicit && FAILURE_CODES[explicit]) return describe(explicit);

  if (input.name === 'AbortError' || /abort|cancelled|canceled/.test(lower)) return describe('CANCELLED');
  if (/interrupted/.test(lower) || eventType === 'interrupted') return describe('INTERRUPTED');
  if (/budget exceeded|latency budget/.test(lower)) return describe('BUDGET_EXCEEDED');
  if (/gate failed/.test(lower) || eventType === 'phase_gate_failed') return describe('GATE_FAILED');
  if (/unknown tool|not a registered tool/.test(lower)) return describe('TOOL_UNKNOWN');
  if (/requires approval|capability token/.test(lower)) return describe('TOOL_APPROVAL');
  if (/denied|forbidden|blocked/.test(lower) && (eventType === 'security_block' || where === 'security' || input.tool)) {
    return describe(eventType === 'security_block' ? 'SAFETY_QUARANTINE' : 'SAFETY_DENIED');
  }
  if (eventType === 'security_block' || eventType === 'security_denied') return describe('SAFETY_QUARANTINE');
  if (/timeout|timed out|etimedout/.test(lower)) return describe(eventType.startsWith('tool') || input.tool ? 'TOOL_TIMEOUT' : 'PROVIDER_ERROR');
  if (eventType === 'tool_error' || input.tool) return describe('TOOL_FAILED');
  if (/json|parse|unexpected token|unparseable/.test(lower)) return describe('FORMAT_INVALID_JSON');
  if (/empty|no output|missing content/.test(lower)) return describe('FORMAT_EMPTY_OUTPUT');
  if (/retriev|recall|scout/.test(where) || /retriev|recall/.test(lower)) return describe('RETRIEVAL_FAILED');
  if (/plan|verif/.test(where)) return describe('PLAN_INVALID');
  if (/provider|fetch failed|econn|enotfound|network|socket|http 5\d\d|rate limit/.test(lower)) return describe('PROVIDER_ERROR');
  return describe('INTERNAL');
}

function describe(code) {
  const meta = FAILURE_CODES[code] ?? FAILURE_CODES.INTERNAL;
  return { code, category: meta.category, retryable: meta.retryable, summary: meta.description };
}

export function isFailureCategory(category) {
  return CATEGORIES.has(category);
}

// True for events that should carry a classified failure in the stream/store.
export function isFailureEvent(event = {}) {
  return ['error', 'tool_error', 'security_block', 'phase_gate_failed', 'interrupted'].includes(event.type);
}
