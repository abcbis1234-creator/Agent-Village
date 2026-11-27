// Security Reviewer — LLM security implementation.
//
// Research basis:
//   - Prompt injection: untrusted data must never become instructions (delimiter boundaries)
//   - Privilege escalation: tool calls must not exceed their declared authority
//   - Data exfiltration: outputs must not leak system secrets, keys, or internal config
//   - Tool output sanitization: tool results are untrusted data, re-validate before display
//   - Defense in depth: pre-flight check (before execution) + post-flight check (after output)

const SENSITIVE_PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/,                                    // API keys
  /Bearer\s+[A-Za-z0-9\-_.+/=]{20,}/i,                     // Bearer tokens
  /api[_-]?key/i,                                          // API key mentions
  /authorization:/i,                                       // Authorization headers
  /password/i,                                             // Passwords
  /secret/i,                                               // Secrets
  /-----BEGIN.*PRIVATE KEY-----/,                          // Private keys
  /root:x:/,                                               // /etc/passwd
  /BEGIN OPENSSH PRIVATE KEY/,                             // SSH keys
];

const DANGEROUS_TOOL_ARGS = {
  sd_generate: ['prompt'], // image prompts can contain injection attempts
};

const PROMPT_INJECTION_MARKERS = [
  /ignore\s+.*?instructions/i,
  /disregard\s+.*?prior/i,
  /you\s+are\s+now\s+dan/i,
  /system\s*prompt/i,
  /reveal\s+your\s+instructions/i,
  /bypass\s+(?:the\s+)?(?:approval|gate|filter)/i,
  /sudo\s+/i,
  /rm\s+-rf/i,
  /exec\s*\(/i,
  /eval\s*\(/i,
];

// Tool risk classification (which tools need security review).
const TOOL_RISK = {
  calculator: 'safe',
  clock: 'safe',
  remember: 'guarded',     // writes to memory — could store secrets
  recall: 'safe',          // reads memory — read-only
  storyboard: 'safe',      // deterministic local planner — no external effects
  sd_generate: 'guarded',  // external call — could exfiltrate via prompt
  external_http: 'guarded', // network call — highest risk
};

export class SecurityReviewer {
  constructor(options = {}) {
    this.strictMode = options.strictMode ?? true;
    this.auditLog = [];
    this.blockedCalls = [];
  }

  // ---------- Pre-flight: review a tool call before execution ----------

  reviewToolCall({ tool, args, user = 'anon', runId }) {
    const risk = TOOL_RISK[tool] ?? 'guarded';
    const issues = [];

    // 1. Check for dangerous argument patterns.
    for (const [argName, argValue] of Object.entries(args ?? {})) {
      const argStr = String(argValue ?? '');
      const injection = PROMPT_INJECTION_MARKERS.find((p) => p.test(argStr));
      if (injection) {
        issues.push({
          type: 'prompt_injection',
          severity: 'critical',
          argument: argName,
          evidence: argStr.slice(0, 200),
          matcher: injection.source,
        });
      }

      const secret = SENSITIVE_PATTERNS.find((p) => p.test(argStr));
      if (secret) {
        issues.push({
          type: 'secret_leak',
          severity: 'critical',
          argument: argName,
          evidence: '[redacted]',
          matcher: secret.source,
        });
      }
    }

    // 2. Check for permission escalation.
    const escalation = this.checkEscalation(tool, args);
    if (escalation) issues.push(escalation);

    const blocked = issues.some((i) => i.severity === 'critical');

    const review = {
      tool,
      args,
      user,
      runId,
      risk,
      blocked,
      allowed: !blocked,
      issues,
      decision: blocked ? 'block' : 'allow',
      reviewedAt: Date.now(),
    };

    this.auditLog.push(review);
    if (blocked) this.blockedCalls.push(review);

    return review;
  }

  // ---------- Post-flight: review tool output after execution ----------

  reviewToolOutput({ tool, output, user = 'anon', runId }) {
    const outputStr = String(output ?? '');
    const issues = [];

    // 1. Check output for leaked secrets.
    const secret = SENSITIVE_PATTERNS.find((p) => p.test(outputStr));
    if (secret) {
      issues.push({
        type: 'secret_in_output',
        severity: 'critical',
        tool,
        evidence: '[redacted]',
        matcher: secret.source,
      });
    }

    // 2. Check output for prompt injection that could affect downstream agents.
    const injection = PROMPT_INJECTION_MARKERS.find((p) => p.test(outputStr));
    if (injection) {
      issues.push({
        type: 'injection_in_output',
        severity: 'critical',
        tool,
        evidence: outputStr.slice(0, 200),
        matcher: injection.source,
      });
    }

    // 3. Check for excessive output (potential exfiltration).
    if (outputStr.length > 50000) {
      issues.push({
        type: 'excessive_output',
        severity: 'medium',
        tool,
        evidence: `output length ${outputStr.length} exceeds 50KB`,
      });
    }

    const blocked = issues.some((i) => i.severity === 'critical');

    const review = {
      tool,
      output,
      user,
      runId,
      blocked,
      allowed: !blocked,
      issues,
      decision: blocked ? 'block' : 'allow',
      reviewedAt: Date.now(),
    };

    this.auditLog.push(review);
    if (blocked) this.blockedCalls.push(review);

    return review;
  }

  // ---------- Permission escalation check ----------

  checkEscalation(tool, args) {
    const argStr = JSON.stringify(args ?? {}).toLowerCase();

    // Remembering secrets is an escalation — memory is durable.
    if (tool === 'remember' && /key|token|password|secret/i.test(argStr)) {
      return {
        type: 'permission_escalation',
        severity: 'critical',
        tool,
        evidence: 'remember tool called with potential secret',
        suggestion: 'Do not store secrets in memory. Use environment variables instead.',
      };
    }

    // SD generation with external URLs could exfiltrate.
    if (tool === 'sd_generate' && /https?:\/\//i.test(argStr)) {
      return {
        type: 'permission_escalation',
        severity: 'high',
        tool,
        evidence: 'sd_generate prompt contains external URL',
        suggestion: 'Do not include external URLs in image prompts.',
      };
    }

    return null;
  }

  // ---------- Convenience: combined pre-flight gate ----------

  gate({ tool, args, user = 'anon', runId }) {
    const review = this.reviewToolCall({ tool, args, user, runId });
    return {
      allowed: review.decision === 'allow',
      review,
    };
  }

  // ---------- Reporting ----------

  getAuditLog() {
    return [...this.auditLog];
  }

  getBlockedCalls() {
    return [...this.blockedCalls];
  }

  stats() {
    const total = this.auditLog.length;
    const blocked = this.blockedCalls.length;
    const bySeverity = {};
    for (const r of this.auditLog) {
      for (const i of r.issues) {
        bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
      }
    }
    return {
      totalReviews: total,
      blockedCalls: blocked,
      allowRate: total > 0 ? ((total - blocked) / total) * 100 : 100,
      bySeverity,
    };
  }
}

// Singleton instance for server-wide use.
export const securityReviewer = new SecurityReviewer();
