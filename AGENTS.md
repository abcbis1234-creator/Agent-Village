# Agent Village — AI Contributor Guidance

This file guides AI systems (and humans) who want to contribute to Agent Village. It complements `AGENT_HANDOFF.md`.

## How to contribute

1. **Read the contract** — `AGENT_HANDOFF.md` defines the boundary: reviewed Git contribution is preferred; the runtime contract (`GET /api/agent-contract`, `POST /api/run`) is bounded and provider-neutral.
2. **Create a branch** off `main`, never push directly to `main`.
3. **Make scoped changes** — state scope, changed files, tests run, known limitations, and whether you add a new connector.
4. **Run checks** — `npm run lint` and `npm test` must pass.
5. **Open a pull request** — a human or trusted maintainer reviews the diff before merge and publication.

## What you must NOT do

- Do not request, return, or log browser-side secrets, API keys, or credentials.
- Do not add shell execution, arbitrary file writes, publishing rights, or unattended automation.
- Do not change the server-only seam or expose provider configuration to the frontend.
- Do not weaken `staticFile` path guards or security headers in `server.mjs`.

## Where to add new capability

- New connector adapters belong behind the server boundary in `server.mjs`, exposed through explicit capability modules.
- Frontend-only UI changes go in `public/` (HTML, CSS, JS).
- New API routes go in `server.mjs` `handleRequest` and must follow the same security header and input-validation pattern.

## Reliability modules

- `lib/json.mjs` — parser-driven JSON extraction/repair. Use `extractJson` for any LLM-authored JSON; never reintroduce a greedy `/\{[\s\S]*\}/` + `JSON.parse`.
- `lib/llm.mjs` — per-provider `CircuitBreaker`, `chatStreamWithFallback`, and `providerHealth`. Long missions should use a provider chain, not a single provider.
- `lib/security.mjs` — `checkContent`/`scanToolOutput` with context-scoped rules (`user_input`, `tool_result`, `document`, `memory_write`). Shell/SSRF patterns belong on a tool's `dangerousArgs`; prose fields get secret/path checks only.
- `lib/archivist.mjs` — memory writes are guarded; corrections supersede via `correct()` instead of overwriting.

## Testing

- `npm run lint` — syntax-checks `server.mjs`, `lib/*.mjs`, `public/app.js`, `bin/cli.mjs`, and `tests/*.mjs`.
- `npm test` — runs the Node built-in test suite under `tests/`.
- `npm run eval` — golden routing suite (`eval/golden.json`).
- `npm run eval:security` — adversarial prompt-injection suite (`eval/adversarial.json`); verifies untrusted mission text never becomes instructions, leaks server secrets, or escapes deliverable bounds.
- `npm run verify` — lint + test + both evals. Run this before opening a PR.
- Add tests for any new route or behavior change. New observability/cancel/accounting surface is covered in `tests/server.test.mjs`.

## Commit message style

Use concise, imperative messages, e.g.:

```
feat: add webnovel capability template

fix: harden static file path traversal guard

test: add coverage for /api/run validation
```

## Review checklist

Before requesting review, confirm:

- [ ] Scope is stated in the PR description
- [ ] Changed files are listed
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] No secrets or credentials introduced
- [ ] No new provider keys exposed to browser
- [ ] Path traversal and security headers intact (if `server.mjs` touched)
