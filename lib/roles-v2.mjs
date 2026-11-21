// roles-v2.mjs — typed I/O contracts + display metadata for the Tier 2 roles.
//
// The runtime behavior lives in memory-v2.mjs / critic-v2.mjs / security-v2.mjs.
// This file is the declarative contract: what each role consumes and produces, so
// the orchestrator, the API, and external agents agree on the shape.

export const TIER2_ROLES = {
  archivist: {
    id: 'archivist',
    name: 'Archivist',
    emoji: '🗂️',
    color: '#8b5cf6',
    tier: 2,
    role: 'Maintains typed, append-only memory with reflection and consolidation.',
    inputs: {
      query: 'string',
      user: 'string',
      types: 'string[]?',
      importance: '1-5?',
    },
    outputs: {
      context: 'MemoryPacket[]',
      reflections: 'Memory[]?',
      consolidation: '{ merged, decayed, promoted }?',
    },
    memoryTypes: ['episodic', 'semantic', 'procedural', 'core'],
  },
  critic: {
    id: 'critic',
    name: 'Critic',
    emoji: '⚖️',
    color: '#f59e0b',
    tier: 2,
    role: 'Independent adversarial review through three lenses. Never sees builder self-assessment.',
    inputs: {
      artifact: 'string',
      request: 'string',
      context: 'string?',
      builderProvider: 'string',
      criticProvider: 'string?',
    },
    outputs: {
      verdict: 'accept|reject',
      findings: 'Finding[]',
      issues: 'string[] (backward-compatible alias)',
      confidence: '0..1',
      calibrated: 'low|medium|high',
      providerIndependent: 'boolean',
    },
    lenses: ['falsification', 'callerVerification', 'steelman'],
  },
  securityReviewer: {
    id: 'securityReviewer',
    name: 'Security Reviewer',
    emoji: '🛡️',
    color: '#ef4444',
    tier: 2,
    role: 'Deterministic-first tool-call gate with semantic escalation, capability tokens, and signed audit.',
    inputs: {
      tool: 'string',
      args: 'object',
      capabilityToken: 'string?',
    },
    outputs: {
      verdict: 'allow|allow_logged|require_approval|deny|quarantine',
      layer: 'L1|L2',
      reasons: 'string[]',
      signature: 'sha256(32 hex)',
    },
    verdicts: ['allow', 'allow_logged', 'require_approval', 'deny', 'quarantine'],
  },
};

export function tier2RoleList() {
  return Object.values(TIER2_ROLES).map(({ id, name, emoji, color, tier, role }) => ({
    id,
    name,
    emoji,
    color,
    tier,
    role,
  }));
}