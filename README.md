# Agent Village

An 8-role multi-agent orchestrator. Zero npm dependencies. Runs on Node 20+.

## Quick start

    git clone <repo>
    cd Agent-Village
    npm start        # http://127.0.0.1:3000
    node bin/cli.mjs # CLI REPL

## The 8 roles

| Layer | Role | Does |
|---|---|---|
| Coordination | 🔍 Scout | Recon before planning |
| Coordination | 🧭 Planner | JSON plan of tool calls |
| Execution | 🛠️ Builder | Runs tools via DAG engine |
| Cross-cutting | 🛡️ Verifier | Deterministic checks (no LLM) |
| Cross-cutting | 🧩 Synthesizer | Evidence brief |
| Cross-cutting | 🔎 Reviewer | Streams the final answer |
| Cross-cutting | ⚖️ Critic | 3-lens adversarial review |
| Cross-cutting | 📚 Archivist | Memory: recall/reflect/consolidate |
| Cross-cutting | 🔒 Security Reviewer | Deterministic L1 tool gate |

## Reliability & safety upgrades

- **JSON repair** (`lib/json.mjs`) — parser-driven extraction with depth/length limits and prototype-pollution guards. Planner, Scout, and Critic no longer depend on a greedy regex.
- **Provider circuit breakers** (`lib/llm.mjs`) — per-provider rolling failure window, half-open probes, and a failover chain for planning. `GET /api/providers/health` now reports breaker state.
- **Context-scoped security** (`lib/security.mjs`) — injection rules run only in contexts where they apply (`user_input`, `tool_result`, `document`); tool outputs are quarantined before reaching the model; shell metacharacters are checked only on declared dangerous args; every decision is persisted to the signed audit log.
- **Memory-write guard** (`lib/archivist.mjs`) — secrets and invisible-unicode payloads never enter durable memory; corrections supersede instead of overwriting.

`npm test` covers the new JSON, resilience, security, and Archivist behavior.

## API

- `GET /api/health` — `{ ok: true }`
- `GET /api/agents` — role catalog
- `GET /api/providers` — configured LLM providers
- `GET /api/providers/health` — probe each provider
- `GET /api/conversations` / `POST /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations/:id/chat` — SSE stream
- `POST /api/runs/:id/cancel`
- `POST /api/runs/:id/suspend` — pause at the next phase boundary
- `POST /api/runs/:id/resume` — continue a suspended run from its checkpoint
- `GET /api/runs/:id/checkpoints` — list stored checkpoints for a run
- `GET /api/runs/:id/events` / `GET /api/runs/:id/export`
- `GET /api/memory/retrieve?q=...`
- `POST /api/memory/consolidate` — decay / promote / merge
- `POST /api/memory/reflect` — synthesize episodic → semantic beliefs
- `GET /api/memory/stats`
- `GET/POST /api/knowledge` / `POST /api/feedback`

### Town (OpenWants + Emergent City mechanics)

- `GET /api/wants?status=open` — the shared wants board
- `POST /api/wants` — publish a want (`{ text, author?, tags?, reward? }`)
- `POST /api/wants/:id/claim` — claim an open want
- `POST /api/wants/:id/fulfill` — fulfill a claimed want (`{ result? }`)
- `POST /api/wants/:id/cancel` — cancel your own want
- `POST /api/godmode` — god-mode action (`{ action, target?, magnitude? }`)
- `GET /api/world/events` — recent world events
- `GET /api/world/stream` — live SSE world-event stream
- `GET /api/chronicle` — Markdown town newspaper
- `GET /api/town/stats` — agents / wants / events / runs / memories
- `POST /api/town/tick` — advance one deterministic simulation tick

## SSE events

`start` · `phase` · `memory_packet` · `scout_report` · `planner_raw` · `security_decision` · `tool_call` · `tool_result` · `tool_error` · `tool_denied` · `verification` · `brief` · `message_start` · `chunk` · `message_end` · `critique` · `revision_requested` · `archive_written` · `budget` · `suspended` · `done`

## Scripts

- `npm start` — serve
- `npm run dev` — watch mode
- `npm run lint` — syntax-check all files
- `npm test` — run all tests
- `npm run eval` — golden routing suite
- `npm run eval:security` — adversarial prompt-injection suite
- `npm run ideas:check` — validate the upgrade catalog
- `npm run verify` — lint + tests + catalog + both evals

## Upgrade backlog

[`docs/ideas/`](docs/ideas/README.md) contains 1,040 researched upgrade ideas across
orchestration, durability, memory, models, tools, security, evaluation, observability,
APIs, UX, simulation, and original experiments. Every idea has an id, an integration
point, an effort estimate, and a source. Start with the
[top 50 roadmap](docs/ideas/README.md#top-50-roadmap).

## Providers

Set `VILLAGE_PROVIDER` to `mock`, `openai`, `ollama`, or `anthropic`. Without
configuration, the server defaults to `mock` (deterministic, no network).

## Security

- Path traversal blocked (resolved containment + stat check)
- CSP + X-Frame-Options + nosniff + Referrer-Policy on every response
- Rate limited (120 req/min/IP)
- Bounded request bodies (64 KB)
- Deterministic L1 security gate on every tool call (allow-list + strict schema + hard-deny patterns)
- `textContent`-only DOM rendering
- Loopback-only bind by default