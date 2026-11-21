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

## API

- `GET /api/health` — `{ ok: true }`
- `GET /api/agents` — role catalog
- `GET /api/providers` — configured LLM providers
- `GET /api/providers/health` — probe each provider
- `GET /api/conversations` / `POST /api/conversations`
- `GET /api/conversations/:id`
- `POST /api/conversations/:id/chat` — SSE stream
- `POST /api/runs/:id/cancel`
- `GET /api/runs/:id/events` / `GET /api/runs/:id/export`
- `GET /api/memory/retrieve?q=...`
- `POST /api/memory/consolidate`
- `GET/POST /api/knowledge` / `POST /api/feedback`

## SSE events

`start` · `phase` · `memory_packet` · `scout_report` · `planner_raw` · `security_decision` · `tool_result` · `tool_error` · `verification` · `brief` · `message_start` · `chunk` · `message_end` · `critique` · `budget` · `done`

## Scripts

- `npm start` — serve
- `npm run dev` — watch mode
- `npm run lint` — syntax-check all files
- `npm test` — run all tests

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