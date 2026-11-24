# Security Policy & Threat Model

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.x     | :white_check_mark: |

## Reporting a Vulnerability

Disclose responsibly. Open an issue or contact the maintainer directly. Never post secrets, API keys, credentials, or exploit code in public issues.

## Trust Boundaries

```
 Browser ──HTTP──▶ server.mjs ──▶ lib/security (L1+L2 gate)
   │                  │                    │
   │            lib/orchestrator        lib/tools (calculator, clock,
   │             (8-role pipeline)       remember, recall, sd_generate)
   │                  │
   │            lib/llm (providers)  ◀── server-only credentials
   │            lib/store (JSON)     ◀── atomic writes, audit hash chain
```

- **Untrusted**: browser input, LLM output, tool output, retrieved memory, document content.
- **Trusted**: server process, environment variables (provider keys), the local filesystem store.
- **Server-only seam**: provider keys and `VILLAGE_API_TOKEN` never reach the browser. The frontend only talks to `server.mjs`.

## Threats & Mitigations

| Threat | Mitigation |
|--------|-----------|
| **Prompt injection** (user/tool/doc content becomes instructions) | `lib/security.mjs` context-scoped rules (`user_input`, `tool_result`, `document`); tool outputs quarantined before reaching the model; `eval/adversarial.mjs` regression suite |
| **Secret exfiltration** | `lib/redact.mjs` redacts keys/tokens from logs, SSE, audit, exports, and errors; secret patterns block storage in memory writes |
| **SSRF / egress abuse** | `external_http` default-deny egress allowlist; private-IP/link-local patterns denied in `_l1`; guarded tools require capability tokens |
| **Path traversal** | `staticFile` resolves + verifies the result stays inside `public/`; rejects `..` and NUL bytes |
| **Capability replay** | Capability tokens are user-bound, single-use (or scoped), TTL-expiring, and optionally resource-bound (`lib/security.mjs`) |
| **Audit tampering** | Hash-chained audit records (`prevHash`/`hash`); `verifyAuditChain()` detects any mutation; exports are signed (HMAC) |
| **Run interruption / crash** | Per-phase checkpoints; `POST /api/runs/:id/resume` continues without re-running side-effecting tools |
| **Resource exhaustion** | Rate limit (120/min/IP), 64 KB body cap, `MAX_ACTIVE_RUNS` backpressure (503 + Retry-After), graceful drain on SIGTERM |
| **Prototype pollution** | `lib/json.mjs` excludes `__proto__`/`constructor`/`prototype` keys; fuzz-tested |
| **Malformed LLM output** | `lib/json.mjs` parser-driven extraction with depth/length limits; never a greedy regex + `JSON.parse` |

## Defense in Depth

1. **L1 deterministic gate** — schema + arg validation, shell/SSRF/secret/path patterns on declared dangerous args only.
2. **L2 semantic review** — optional LLM check for intent mismatch / exfiltration (fail-closed to deny on parse failure).
3. **Tool-output rail** — `scanToolOutput` quarantines critical findings before they reach the model.
4. **Audit** — every security decision is persisted to the hash-chained audit log.

## Deployment Hardening

- Set `VILLAGE_API_TOKEN` to require bearer auth on `/api/*`.
- Set `VILLAGE_OFFLINE=1` for air-gapped / local-first runs (forces mock provider, skips probes).
- Run behind a TLS-terminating reverse proxy; the server speaks plain HTTP.
- Pin Node 20+; the store is a single JSON file — use a volume for `data/`.
- Rotate provider keys and `VILLAGE_API_TOKEN` regularly; audit records are hash-chained so rotation events are verifiable.

## Contributor Rules

- Never introduce shell execution, arbitrary file writes, or unattended automation.
- Never weaken `staticFile` path guards, security headers, or the redaction pipeline.
- Keep all provider connectors behind the server boundary.
- Run `npm run verify` (lint + test + evals) before opening a PR.