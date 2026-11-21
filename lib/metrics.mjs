export function createMetrics() {
  const counters = { requests: 0, chats: 0, toolCalls: 0, errors: 0, approvals: 0, cancels: 0, securityDenials: 0, criticRejects: 0 };
  const latencies = [];
  const startedAt = Date.now();
  return {
    inc(k, n = 1) { counters[k] = (counters[k] ?? 0) + n; },
    observeLatency(ms) {
      latencies.push(ms);
      if (latencies.length > 500) latencies.shift();
    },
    snapshot() {
      const sorted = [...latencies].sort((a, b) => a - b);
      const p = (q) => sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : 0;
      return { ...counters, uptimeMs: Date.now() - startedAt, startedAt, latency: { p50: p(0.5), p95: p(0.95), p99: p(0.99), samples: sorted.length } };
    },
  };
}