# Migration: main → v2.0

## Preserved
Every feature in main (7f708b3 / d07a263) is present, at the same path:

- `VILLAGE_API_TOKEN` bearer auth (also accepts `?token=`) — `server.mjs:checkToken`
- `X-Village-User` scoping on conversations, memories, feedback, knowledge
- `GET /api/providers/health` — backed by `probeAllProviders()` in `lib/llm.mjs`
- `POST /api/runs/:id/cancel` — works via `AbortController` threaded through `Workflow`
- Tool approval gates — `lib/policy.mjs`; `POST /api/approvals/:id` and `POST /api/tools/approve`
- `sd_generate` tool — same interface, still approval-gated via `POST /api/media/generate`
- `POST/GET /api/feedback` — now backed by vector memory (same request/response shape)
- `GET/POST /api/knowledge` — vector-backed; same shape
- Rich metrics — `lib/metrics.mjs` (adds p50/p95/p99 latency)
- `eval/` golden + adversarial suites — updated for the new conversation/chat API
- Webnovel capability templates — `POST /api/capabilities`

## New in v2.0
- `lib/llm.mjs` — OpenAI-compatible, Ollama, Anthropic, and deterministic mock adapters; zero deps
- `lib/bus.mjs` — agent-to-agent typed message bus (ask/tell/delegate/broadcast)
- `lib/memory.mjs` — deterministic hash embeddings + cosine similarity vector memory
- `lib/workflow.mjs` — DAG engine with checkpoints, cooperative cancellation, approval gates
- `lib/budget.mjs` — token/cost/latency/tool-call caps enforced per run
- `lib/policy.mjs` — risk-classified approval queue (safe / guarded)
- `lib/signature.mjs` — HMAC-signed run exports
- `GET /api/runs/:id/events` — replayable event log with monotonic seq
- `GET /api/runs/:id/export` — signed JSON export for provenance
- `bin/cli.mjs` — interactive CLI REPL against the running server
- `Dockerfile`, `.github/workflows/ci.yml`

## Behavior changes
- The agents now call a real LLM by default if one is configured. With no provider env vars, they use `mock` — deterministic, fast, hermetic for tests. Set `VILLAGE_PROVIDER=mock` to force mock.
- The planner's output is parsed as JSON. If the LLM returns prose, the orchestrator falls back to keyword-based tool selection.
- Approval requests block the run until `POST /api/approvals/:id` or `POST /api/tools/approve` is called. Cancel releases them.
- Signed exports require `VILLAGE_EXPORT_SECRET`. The default is insecure; set it in production.

## Not yet wired
- The UI does not yet surface the approval queue, replay viewer, or budget panel. The API is there; the frontend panel is a follow-up.
- `eval/` tests the new conversation/chat API (valid bounded results), not the old capability-key routing.
