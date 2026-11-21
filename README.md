# Agent Village 🏘️

A multi-agent orchestration playground — **zero dependencies**, only Node built-ins.

Every message goes through three agents in sequence:

```
🧭  Planner   →  proposes a plan of tool calls
🛠️  Builder   →  runs the tools and collects results
🔎  Reviewer  →  streams back a synthesized answer
```

Everything is real: SSE streaming, a tool registry (safe calculator, clock, vector memory), persisted conversations + memories, approval gates, budgets, checkpoints, and a CLI. The agents are rule-based/LLM-backed — plug in a real LLM provider if you like; the architecture is already in place.

## Quick start

```bash
git clone https://github.com/abcbis1234-creator/Agent-Village.git
cd Agent-Village
cp .env.example .env      # optional
npm start                 # http://127.0.0.1:3000

# in another terminal:
node bin/cli.mjs          # interactive REPL against the running server
```

Requires Node 20+.

## What you can ask

| Ask… | Agent uses |
|---|---|
| "what is 12 * 8 + 4?" | `calculator` |
| "what time is it?" | `clock` |
| "remember that the sky is blue" | `remember` |
| "what do you know about the sky?" | `recall` |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | `{ ok: true }` |
| `GET` | `/api/metrics` | request counters, latency percentiles, uptime |
| `GET` | `/api/agents` | agent definitions |
| `GET` | `/api/providers` | LLM provider status |
| `GET` | `/api/providers/health` | active liveness probes |
| `GET` | `/api/capabilities` | registered capabilities |
| `GET` | `/api/conversations` | list (scoped by `X-Village-User`) |
| `POST` | `/api/conversations` | `{ agentId, title? }` |
| `GET` | `/api/conversations/:id` | get one |
| `POST` | `/api/conversations/:id/chat` | **SSE stream** — `{ message, provider? }` |
| `POST` | `/api/run` | backward-compat — `{ mission, capability?, rounds?, stream? }` |
| `POST` | `/api/run/:id/cancel` | cancel an in-flight run |
| `GET` | `/api/runs/:id/events` | replayable event log |
| `GET` | `/api/runs/:id/export` | HMAC-signed JSON export |
| `GET` | `/api/approvals` | pending approvals |
| `POST` | `/api/approvals/:id` | approve/decline an approval |
| `POST` | `/api/tools/approve` | alias for `/api/approvals/:id` |
| `POST` | `/api/media/generate` | image gen (approval-gated) |
| `POST` | `/api/media/approve` | approve a media generation |
| `GET/POST` | `/api/feedback` | vector-backed feedback |
| `GET/POST` | `/api/knowledge` | vector-backed knowledge |

The chat endpoint emits `start`, `phase`, `message`, `tool_call`, `tool_result`, `tool_error`, `message_start`, `chunk`, `message_end`, `budget`, `done`.

## Keyboard

- `⌘K` / `Ctrl+K` — command palette (jump to conversation)
- `Esc` — close palette

## Scripts

| Script | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start with `--watch` for auto-restart |
| `npm run lint` | Syntax-check every source file |
| `npm test` | Run the `node:test` suite |
| `npm run eval` | Golden missions — valid bounded results |
| `npm run eval:security` | Adversarial prompt-injection suite |
| `npm run verify` | lint + test + eval + security |

## Docker

```bash
docker build -t agent-village .
docker run --rm -p 3000:3000 agent-village
```

`HOST` defaults to `127.0.0.1`; the image overrides it to `0.0.0.0` so it's reachable.

## Security

- Path-traversal protection on static serving (resolved-path containment + `stat` isFile check).
- CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` on every response.
- Rate-limited API (120 req/min/IP) with sliding window.
- Bounded request bodies (64 KB); malformed JSON returns `400`, never crashes.
- All DOM rendering uses `textContent` — no `innerHTML` injection surface.
- Optional token auth (`VILLAGE_API_TOKEN`) for write endpoints.
- Per-user scoping (`X-Village-User`).
- Atomic JSON persistence (write + rename).
- Binds to loopback by default.

To report a vulnerability, open a private security advisory on the repo.
