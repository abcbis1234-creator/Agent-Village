export const AGENTS = {
  scout: {
    id: 'scout', name: 'Scout', emoji: '🔍', color: '#64748b',
    role: 'Read-only reconnaissance. Maps the request before planning.',
    system: `You are Scout. Given a user message, output a compact JSON recon report:
{"intent":"one line","domain":"one word","ambiguities":["..."],"suggestedTools":["calculator|clock|remember|recall|sd_generate"]}
Return ONLY JSON. Do not solve the task. Do not call tools.`,
    maxTokens: 250,
  },
  planner: {
    id: 'planner', name: 'Planner', emoji: '🧭', color: '#4f8cff',
    role: 'Produces a JSON plan of tool calls.',
    system: `You are Planner. Output ONLY compact JSON:
{"steps":[{"tool":"calculator|clock|remember|recall|sd_generate","args":{...}}]}
If no tools needed: {"steps":[]}. Do not include prose. Do not invent tools.`,
    maxTokens: 300,
  },
  builder: {
    id: 'builder', name: 'Builder', emoji: '🛠️', color: '#22c55e',
    role: 'Executes tools via the DAG engine.',
  },
  verifier: {
    id: 'verifier', name: 'Verifier', emoji: '🛡️', color: '#06b6d4',
    role: 'Deterministic checks — arithmetic re-check, secret scan, tool-result sanity. Never LLM.',
  },
  synthesizer: {
    id: 'synthesizer', name: 'Synthesizer', emoji: '🧩', color: '#a855f7',
    role: 'Merges tool results and verification into one evidence brief.',
  },
  reviewer: {
    id: 'reviewer', name: 'Reviewer', emoji: '🔎', color: '#f59e0b',
    role: 'Streams the final answer from the evidence brief.',
    system: `You are Reviewer. Answer the user clearly using the provided evidence brief.
Be direct. Do not fabricate. Keep under 200 words. If verification flagged problems, say so.`,
    maxTokens: 500,
  },
  critic: {
    id: 'critic', name: 'Critic', emoji: '⚖️', color: '#ef4444',
    role: 'Adversarial review through three lenses. Never sees builder self-assessment.',
  },
  archivist: {
    id: 'archivist', name: 'Archivist', emoji: '📚', color: '#8b5cf6',
    role: 'Typed memory: retrieval, reflection, consolidation.',
  },
  securityReviewer: {
    id: 'securityReviewer', name: 'Security Reviewer', emoji: '🔒', color: '#dc2626',
    role: 'Deterministic tool-call gate before execution.',
  },
};

export function publicAgents() {
  return Object.values(AGENTS).map((a) => ({
    id: a.id, name: a.name, emoji: a.emoji, color: a.color, role: a.role,
  }));
}