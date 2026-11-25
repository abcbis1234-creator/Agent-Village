# Security, safety, and governance — 100 ideas

Security work is split between deterministic controls (which this repo favors),
model-level defenses, and operational process. Existing coverage includes security
headers, a static path guard, secret scanning, an adversarial eval suite, and a
tamper-evident audit chain.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| SEC-001 | Threat model document | Assets, actors, entry points, and mitigations in one reviewed file | `SECURITY.md` | S | OWASP |
| SEC-002 | Data-flow diagram | Show where prompts, tool output, memory, and secrets cross trust boundaries | `docs/` | S | OWASP |
| SEC-003 | Trust boundary tests | Assert that untrusted text never reaches an instruction-only channel | `tests/` | M | INJ |
| SEC-004 | STRIDE per component | A short worksheet for server, store, tools, memory, and UI | `docs/` | S | OWASP |
| SEC-005 | OWASP LLM mapping | Map each control and eval to the relevant OWASP LLM category | `docs/` | S | OWASP |
| SEC-006 | Deny-by-default policy | Unknown tools, routes, providers, and scopes are refused unless explicitly enabled | `lib/policy.mjs` | M | OWASP |
| SEC-007 | Fail-closed config validation | Refuse to boot on missing or contradictory security settings | `server.mjs` | S | OWASP |
| SEC-008 | Direct injection corpus | A growing set of override, role-play, and delimiter-escape attacks | `eval/adversarial.json` | S | GARAK |
| SEC-009 | Indirect injection corpus | Payloads hidden in documents, tool results, memory, and URLs | `eval/adversarial.json` | M | INJ |
| SEC-010 | Canary tokens | Unique strings that must never appear in output, used to detect prompt leaks | `lib/security.mjs` | S | INJ |
| SEC-011 | Dual-model pattern | A privileged planner and a quarantined reader that only returns typed data | `lib/orchestrator.mjs` | L | INJ |
| SEC-012 | Instruction and data channels | Separate message roles and wrappers so retrieved text cannot pose as instructions | `lib/llm.mjs` | M | INJ |
| SEC-013 | System prompt leak test | Probe for verbatim system prompt disclosure and fail the eval on a match | `eval/` | S | OWASP |
| SEC-014 | Output encoding | Encode model output for its destination context, never trust it as HTML | `lib/security.mjs` | M | OWASP |
| SEC-015 | CSP with nonces | Strict script-src with per-response nonces and no inline event handlers | `server.mjs` | M | OWASP |
| SEC-016 | CSP report-only rollout | Collect violation reports before enforcing a stricter policy | `server.mjs` | S | OWASP |
| SEC-017 | Trusted Types | Adopt Trusted Types in the frontend to block DOM XSS sinks | `public/app.js` | L | OWASP |
| SEC-018 | CSRF tokens | Double-submit or origin-bound tokens for state-changing browser requests | `server.mjs` | M | OWASP |
| SEC-019 | SameSite cookies | Strict or Lax cookies with Secure and HttpOnly flags | `server.mjs` | S | OWASP |
| SEC-020 | Origin allowlist | Reject cross-origin state changes even when credentials are present | `server.mjs` | S | OWASP |
| SEC-021 | CORS allowlist | Explicit origins with no wildcard when credentials are allowed | `server.mjs` | S | OWASP |
| SEC-022 | Hashed API keys | Store only a hash and a prefix, show the key once at creation | `server.mjs` | M | OWASP |
| SEC-023 | Session tokens | Short-lived, rotated session tokens for browser use | `server.mjs` | M | OWASP |
| SEC-024 | Token rotation | Rotate keys with an overlap window and an audit record | `server.mjs` | M | OWASP |
| SEC-025 | Constant-time comparison | Use constant-time comparison for every secret and token check | `lib/security.mjs` | S | OWASP |
| SEC-026 | RBAC | Roles for viewer, operator, approver, and admin with explicit permissions | `lib/policy.mjs` | M | OWASP |
| SEC-027 | Tenant isolation | Partition stores, memory, caches, and artifacts by tenant id | `lib/store.mjs` | L | OWASP |
| SEC-028 | Object-level authorization | Check ownership on every run, artifact, and memory access | `server.mjs` | M | OWASP |
| SEC-029 | IDOR tests | Automated attempts to read another user's ids must all fail | `tests/` | S | OWASP |
| SEC-030 | Auth rate limiting | Per-IP and per-account limits with progressive delay | `server.mjs` | S | OWASP |
| SEC-031 | Account lockout | Temporary lockout with a safe unlock path and audit trail | `server.mjs` | S | OWASP |
| SEC-032 | Audit authentication events | Log success, failure, rotation, and lockout without logging secrets | `lib/store.mjs` | S | OWASP |
| SEC-033 | Log injection guard | Escape newlines and control characters in every logged user value | `lib/security.mjs` | S | OWASP |
| SEC-034 | Log redaction | Central redaction for keys, tokens, emails, and request bodies | `lib/security.mjs` | M | OWASP |
| SEC-035 | PII detection | Detect emails, phone numbers, addresses, and government ids in stored text | `lib/security.mjs` | M | OWASP |
| SEC-036 | Entropy secret scanner | Flag high-entropy strings near credential keywords | `lib/security.mjs` | M | OWASP |
| SEC-037 | Pre-commit secret scan | A local hook and CI job that block committed credentials | `.github/` | S | OWASP |
| SEC-038 | Push protection | Enable provider-side secret scanning and push protection | `.github/` | S | OWASP |
| SEC-039 | Dependency policy | Document and enforce the zero-dependency rule with a CI check | `package.json` | S | OWASP |
| SEC-040 | Lockfile integrity | Commit the lockfile and verify it in CI even with zero dependencies | `.github/` | S | OWASP |
| SEC-041 | Action pinning | Pin every GitHub Action to a full commit SHA | `.github/workflows/` | S | OWASP |
| SEC-042 | Minimal workflow token | Set `permissions: contents: read` by default and widen per job only | `.github/workflows/` | S | OWASP |
| SEC-043 | CODEOWNERS | Require review from the security owner for sensitive paths | `.github/` | S | OWASP |
| SEC-044 | Branch protection | Document required checks, linear history, and no force pushes | `docs/` | S | OWASP |
| SEC-045 | Signed commits | Verify signatures on main and document the key setup | `.github/` | S | OWASP |
| SEC-046 | Build provenance | Publish an attestation linking the artifact to the workflow and commit | `.github/` | M | OWASP |
| SEC-047 | SBOM | Generate a dependency and file inventory for each release | `.github/` | S | OWASP |
| SEC-048 | License scan | Assert that vendored code and assets carry compatible licenses | `.github/` | S | OWASP |
| SEC-049 | MCP server allowlist | Only connect to reviewed servers with pinned versions and scopes | `lib/mcp.mjs` | M | MCP/security |
| SEC-050 | MCP tool pinning | Hash tool definitions and alert on any change after approval | `lib/mcp.mjs` | M | MCP/security |
| SEC-051 | Webhook signatures | HMAC-SHA256 over timestamp plus body with a five-minute window | `server.mjs` | S | OWASP |
| SEC-052 | Replay protection | Reject reused nonces and stale timestamps for every signed request | `server.mjs` | S | OWASP |
| SEC-053 | Timestamp window | Small allowed clock skew with a clear error and audit event | `server.mjs` | S | OWASP |
| SEC-054 | Egress proxy | Route optional outbound tools through one audited, allowlisted proxy | `lib/security.mjs` | L | OWASP |
| SEC-055 | DNS rebinding test | A test that resolves a public name to a private address and expects refusal | `tests/` | M | OWASP |
| SEC-056 | Redirect downgrade test | A test that a 302 to http or to a private address is refused | `tests/` | S | OWASP |
| SEC-057 | Path traversal suite | Encoded, double-encoded, and unicode traversal attempts against static and artifact reads | `tests/` | S | OWASP |
| SEC-058 | Symlink escape test | A symlink inside the public directory must not escape its root | `tests/` | S | OWASP |
| SEC-059 | TOCTOU test | Swap a validated path before open and assert the guard still holds | `tests/` | M | OWASP |
| SEC-060 | Zip-slip test | Archive entries with `..` or absolute paths must be rejected | `tests/` | S | OWASP |
| SEC-061 | Prototype pollution test | `__proto__`, `constructor`, and `prototype` keys must be inert everywhere | `tests/` | S | OWASP |
| SEC-062 | JSON depth limit test | Deeply nested payloads fail with a typed error, not a stack overflow | `tests/` | S | OWASP |
| SEC-063 | ReDoS test | Adversarial regex inputs complete within the time budget | `tests/` | S | OWASP |
| SEC-064 | Bidi and homoglyph guard | Detect right-to-left overrides and mixed-script lookalikes in identifiers | `lib/security.mjs` | M | OWASP |
| SEC-065 | Invisible character guard | Reject zero-width and tag characters in stored or displayed text | `lib/security.mjs` | S | OWASP |
| SEC-066 | Encoded payload detection | Decode common encodings before scanning so base64 does not hide instructions | `lib/security.mjs` | M | OWASP |
| SEC-067 | Markdown exfil guard | Proxy or block remote images and links that could leak data via URLs | `lib/security.mjs` | M | OWASP |
| SEC-068 | Image metadata stripping | Remove EXIF and GPS before storing or sending user images | `lib/security.mjs` | S | OWASP |
| SEC-069 | SVG active-content guard | Reject script, event handlers, and external references in SVG | `lib/security.mjs` | S | OWASP |
| SEC-070 | PDF script guard | Do not render active PDF content and cap page and size counts | `lib/security.mjs` | M | OWASP |
| SEC-071 | Spreadsheet formula guard | Escape leading `=`, `+`, `-`, and `@` in exported cells | `lib/security.mjs` | S | OWASP |
| SEC-072 | XML parser hardening test | Assert that every XML path rejects DTDs and external entities | `tests/` | S | OWASP |
| SEC-073 | Safe YAML subset | Reject tags, anchors, and merge keys unless explicitly supported | `lib/security.mjs` | S | OWASP |
| SEC-074 | Template injection guard | Never evaluate user text as a template; resolve names against a fixed map | `lib/security.mjs` | S | OWASP |
| SEC-075 | Header injection guard | Reject CR/LF in values that reach response headers | `server.mjs` | S | OWASP |
| SEC-076 | Host header validation | Use an allowlist for absolute URL generation and redirects | `server.mjs` | S | OWASP |
| SEC-077 | Cache poisoning guard | Never cache responses that vary on untrusted headers without a key | `server.mjs` | M | OWASP |
| SEC-078 | Clickjacking defense | `frame-ancestors` CSP plus `X-Frame-Options: DENY` | `server.mjs` | S | OWASP |
| SEC-079 | HSTS policy | Document HSTS and preload requirements for the hosted deployment | `server.mjs` | S | OWASP |
| SEC-080 | TLS configuration | Minimum version, cipher policy, and certificate renewal notes | `docs/` | S | OWASP |
| SEC-081 | Encrypted secrets at rest | Encrypt provider keys stored in the data directory with a master key | `lib/store.mjs` | L | OWASP |
| SEC-082 | Envelope encryption | Per-record data keys wrapped by a master key for cheaper rotation | `lib/store.mjs` | L | OWASP |
| SEC-083 | Key rotation runbook | Step-by-step rotation with verification and rollback | `docs/` | S | OWASP |
| SEC-084 | Memory poisoning eval | Attempt to persist instructions and assert they never influence later runs | `eval/` | M | OWASP |
| SEC-085 | RAG poisoning eval | Plant a malicious document and assert citations do not repeat its instructions | `eval/` | M | OWASP |
| SEC-086 | Citation spoofing guard | Verify cited spans actually exist and match the quote | `lib/verifier.mjs` | M | RAG |
| SEC-087 | Tool rug-pull detection | Diff tool schemas between sessions and require re-approval on change | `lib/mcp.mjs` | M | MCP/security |
| SEC-088 | Confused deputy guard | Bind every delegated token to the requesting user and audience | `lib/policy.mjs` | M | MCP/security |
| SEC-089 | No token passthrough | Never forward a client token to an upstream API with a different audience | `lib/mcp.mjs` | S | MCP/security |
| SEC-090 | Scope minimization | Request the smallest scope set per connector and show it at approval time | `lib/policy.mjs` | M | OWASP |
| SEC-091 | Two-person approval | High-risk actions need two distinct approvers with an audit trail | `lib/policy.mjs` | M | OWASP |
| SEC-092 | Break-glass access | Time-boxed emergency access that pages the owner and records a reason | `lib/policy.mjs` | M | OWASP |
| SEC-093 | Kill switch | One endpoint that stops all runs and blocks new work until re-enabled | `server.mjs` | S | OWASP |
| SEC-094 | Safe mode | Disable network tools, writes, and generated media with one flag | `server.mjs` | S | OWASP |
| SEC-095 | Incident response plan | Severity levels, owners, communication, and evidence preservation | `docs/` | S | OWASP |
| SEC-096 | Vulnerability disclosure | A private reporting channel and response SLA in `SECURITY.md` | `SECURITY.md` | S | OWASP |
| SEC-097 | CVE process | Triage, fix, advisory, and credit workflow for published issues | `docs/` | S | OWASP |
| SEC-098 | Abuse detection | Flag repeated policy violations, injection attempts, and quota evasion | `lib/security.mjs` | M | OWASP |
| SEC-099 | Resource exhaustion caps | Cap tokens, steps, artifacts, and concurrent runs per user with typed errors | `lib/budget.mjs` | M | OWASP |
| SEC-100 | Audit export and retention | Signed, append-only export to an external sink with a retention schedule | `lib/store.mjs` | M | OWASP |
