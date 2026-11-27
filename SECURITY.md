# Security Policy & Threat Model

## Supported Versions

| Version | Supported |
|---------|-----------|
| 3.x     | :white_check_mark: |

## Reporting a Vulnerability

Disclose responsibly. Open an issue or contact the maintainer directly. Never post secrets, API keys, credentials, or exploit code in public issues.

## Assets

| Asset | Why it matters | Where it lives |
|-------|----------------|----------------|
| Provider credentials | Billing and account access | Server environment only (`lib/llm.mjs` reads them) |
| `VILLAGE_API_TOKEN` | Gates every `/api/*` call when set | Server environment; compared with `timingSafeEqual` |
| Conversation + memory content | Private user data and durable beliefs | `data/state.json`; memory reads are user-scoped |
| Run events + checkpoints | Audit trail and resumability | `data/state.json` (`events`, `checkpoints`) |
| Audit hash chain | Tamper evidence for security decisions | `data/state.json` (`audit`) |
| Signed exports | Verifiable handoff artifacts | Generated per request, HMAC-signed |
| Service availability | Prevents cost blowups and denial of service | Process, rate limiter, budget, concurrency cap |

## Actors

- **Browser user** — sends missions, approves tool calls, reads results. Untrusted input.
- **Operator** — sets environment, allowlists, token, and runs the server.
- **Model provider** — returns untrusted text/JSON; may fail, rate-limit, or be adversarial.
- **Tool / MCP provider** — returns untrusted output; may be compromised.
- **Content attacker** — embeds instructions in documents, memory, or tool results.
- **Local process** — may read or modify `data/state.json` if the host is compromised.

## Entry Points

| Entry point | Validation / control |
|-------------|----------------------|
| `POST /api/conversations/:id/chat` | Auth (if configured), JSON content type, 64 KB body cap, rate limit, user ownership |
| `POST /api/runs/:id/{cancel,suspend,resume}` | Auth, run ownership, status checks |
| `GET /api/runs/:id/{events,checkpoints,export}` | Auth, run ownership; exports redacted + signed |
| `POST /api/wants`, `/api/godmode`, `/api/town/tick` | Auth, JSON validation, idempotency key support |
| `POST /api/memory/*`, `/api/knowledge`, `/api/feedback` | Auth, text validation, user scoping, memory-write guard |
| `GET /api/healthz`, `/readyz`, `/metrics` | Liveness/readiness/metrics; no secrets |
| Static files under `public/` | Path normalization, `public/` containment, NUL rejection, MIME allowlist |
| `external_http` tool | Egress allowlist + approval token + DNS resolution + private-range denial + pinned address + no redirects |
| LLM output / tool output / memory | Context-scoped injection rules; critical tool output quarantined |
| `data/state.json` | Atomic writes, versioned migrations, corrupt-file preservation, audit chain |

## Trust Boundaries

```
 Browser ──HTTP──▶ server.mjs ──▶ lib/security (L1+L2 gate)
   │                  │                    │
   │            lib/orchestrator        lib/tools (calculator, clock,
   │             (8-role pipeline)       remember, recall, storyboard,
   │                  │                  sd_generate, external_http)
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
| **SSRF / egress abuse** | `external_http` default-deny egress allowlist; URL credentials and non-80/443 ports rejected; every DNS answer validated against private/loopback/link-local/CGNAT/metadata ranges; connection pinned to the validated address; redirects blocked; response size capped |
| **Path traversal** | `staticFile` resolves + verifies the result stays inside `public/`; rejects `..` and NUL bytes |
| **Capability replay** | Capability tokens are user-bound, single-use (or scoped), TTL-expiring, and optionally resource-bound (`lib/security.mjs`) |
| **Audit tampering** | Hash-chained audit records (`prevHash`/`hash`); `verifyAuditChain()` detects any mutation; exports are signed (HMAC) |
| **Run interruption / crash** | Per-phase checkpoints; heartbeats with phase/progress; boot recovery marks orphaned `running` runs `interrupted`; `POST /api/runs/:id/resume` continues without re-running side-effecting tools |
| **Silent partial success** | Explicit entry/exit phase gates (`lib/orchestrator.mjs`); a failed gate emits `phase_gate_failed` and stops the run instead of archiving partial output |
| **Cross-user data access** | Conversations, runs, checkpoints, exports, and memories are scoped to `X-Village-User`; run routes check ownership |
| **Resource exhaustion** | Rate limit (120/min/IP), 64 KB body cap, `MAX_ACTIVE_RUNS` backpressure (503 + Retry-After), graceful drain on SIGTERM |
| **Prototype pollution** | `lib/json.mjs` excludes `__proto__`/`constructor`/`prototype` keys; fuzz-tested |
| **Malformed LLM output** | `lib/json.mjs` parser-driven extraction with depth/length limits; never a greedy regex + `JSON.parse` |

## Defense in Depth

1. **L1 deterministic gate** — schema + arg validation, shell/SSRF/secret/path patterns on declared dangerous args only.
2. **L2 semantic review** — optional LLM check for intent mismatch / exfiltration (fail-closed to deny on parse failure).
3. **Tool-output rail** — `scanToolOutput` quarantines critical findings before they reach the model.
4. **Audit** — every security decision is persisted to the hash-chained audit log.

## Residual Risks & Known Limitations

- **L2 semantic review is best-effort.** When a provider is configured, guarded tools get an LLM review; an unparseable review fails closed to deny, but a compromised provider can still return a permissive verdict. L1, the SSRF guard, and capability tokens remain authoritative.
- **Egress allowlists are operator policy.** An allowlisted host that is itself malicious is reachable by design; keep the list narrow and prefer hosts you control.
- **`X-Village-User` is an identity hint, not authentication.** Set `VILLAGE_API_TOKEN` and put the service behind a trusted proxy that sets or strips this header. Without a proxy, any client can choose a user string.
- **The JSON store is single-process.** Multiple server processes must not share one `data/state.json`; use one writer or migrate to a real database before horizontal scaling.
- **In-process rate limiting and idempotency.** Both are per-process and reset on restart; they are not a substitute for a gateway/WAF at scale.
- **Model output is not sandboxed code.** The pipeline never executes LLM-authored code, but a future tool that does must add an isolated runtime before shipping.
- **Memory is durable but not encrypted at rest.** Protect the host/volume; use disk encryption and least-privilege file permissions.

## Review Cadence

Review this file when any of the following changes: a new entry point, a new outbound connector, a new tool risk class, the store schema, authentication/identity handling, or the deployment topology. Security-relevant PRs should state which asset/entry point changed and which mitigation was added or weakened.

## Deployment Hardening

- Set `VILLAGE_API_TOKEN` to require bearer auth on `/api/*`.
- Set `EXTERNAL_HTTP_ALLOWLIST` to a comma-separated host list before enabling `external_http`; empty means deny all egress.
- Set `VILLAGE_OFFLINE=1` for air-gapped / local-first runs (forces mock provider, skips probes).
- Run behind a TLS-terminating reverse proxy; the server speaks plain HTTP.
- Pin Node 20+; the store is a single JSON file — use a volume for `data/`.
- Rotate provider keys and `VILLAGE_API_TOKEN` regularly; audit records are hash-chained so rotation events are verifiable.

## Contributor Rules

- Never introduce shell execution, arbitrary file writes, or unattended automation.
- Never weaken `staticFile` path guards, security headers, or the redaction pipeline.
- Keep all provider connectors behind the server boundary.
- Run `npm run verify` (lint + test + evals) before opening a PR.