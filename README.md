# Agent Village

Agent Village is a managed web workspace for open-ended AI work. It combines a visual Town view, a Station workflow view, and a Workbench for plan review, live activity, confidence, pause/approve controls, and safe handoff to another AI.

The managed release is intentionally provider-neutral. It runs a local demo router behind the server boundary. Future upgrades can add Manus LLM, image, speech, storage, database, scheduling, and video-provider adapters without exposing secrets in the browser.

Other AI systems can contribute through the reviewed Git workflow or the bounded `GET /api/agent-contract` and `POST /api/run` interfaces. They do not receive publishing, shell, secret, or arbitrary write access by default. See `AGENT_HANDOFF.md`.

## Design principles

- **Provider-neutral**: no LLM, image, speech, or storage provider is wired in by default.
- **Server-only seam**: credentials and provider keys never reach the browser.
- **Visible orchestration**: every route, report, and decision is labeled and inspectable.
- **Bounded autonomy**: consequential actions require an explicit approval gate; publication is a separate reviewed checkpoint.

## Development

Requirements: Node.js 20+.

```bash
# install (no dependencies are required)
npm install

# syntax check
npm run check

# run the server (defaults to http://localhost:3000)
npm start

# evaluation harness against golden missions
npm run eval

# adversarial prompt-injection suite
npm run eval:security

# everything (check + test + both evals)
npm run verify

# run with a custom port
PORT=8080 npm start
```

The runtime listens on `PORT` and defaults to `3000`. The frontend is served from `public/`.

## API

### `GET /api/health`
Health check. Returns `{ ok: true, mode, capabilities }`.

### `GET /api/capabilities`
Lists the available capability routes (auto, research, code, writing, planning, analysis, calculator, data, creative, webnovel, video, image, audio, website, automation, local_ops).

### `GET /api/agent-contract`
Returns the bounded contribution contract for external AI agents: version, purpose, endpoints, input shape, return shape, contribution policy, and collaboration guidance.

### `POST /api/run`
Runs a bounded mission through the local demo router.

Request body:
- `mission` (string, required, max 1200 chars)
- `capability` (string, optional, capability key or `auto`)
- `rounds` (integer, optional, 1-3, default 2)

Response:
- `id`, `mission`, `rounds`, `source`, `capability`, `deliverable`, `reports`, `verdict`

Every report is labeled `MANAGED LOCAL DEMO`. The verdict includes a decision, rationale, dissent/watch-outs, next actions, and confidence.

### Static files
`GET /` serves `public/index.html`. `GET /manus-routes.json` serves the route manifest. `GET /media/<file>` serves generated images.

### `GET /api/providers`
Reports media provider status. No secrets are returned.

### `POST /api/media/generate`
Approval-gated media generation. Body:
- `kind` (`image` | `video`)
- `prompt` (string)
- `approved` (boolean)
- `id` (approval id, required when `approved: true`)

Without `approved`, returns `202` with an approval id. Approve it via `POST /api/media/approve` with `{ id }`, then re-post with `approved: true` and the same `id`.

## Observability, cancellation, and cost

### `GET /api/metrics`

Observability snapshot. Contains no secrets.

```json
{
  "uptimeMs": 1472,
  "requests": { "total": 2, "ok": 2, "errors": 0, "rateLimited": 0 },
  "byRoute": { "/api/health": 1, "/api/metrics": 1 },
  "byCapability": {},
  "llm": { "calls": 0, "promptTokens": 0, "completionTokens": 0, "totalTokens": 0, "errors": 0, "avgLatencyMs": 0 },
  "tools": {}, "media": {}, "approval": {}, "activeRuns": 0
}
```

- **Request IDs** — every response carries `X-Request-Id`. A client-supplied `X-Request-Id` is honored and echoed back.
- **Structured logs** — the server emits one JSON object per line: `{ ts, level, message, requestId, method, route, status, ip }`.
- **Token accounting** — when an LLM is configured, `usage` from each completion is accumulated under `llm` (prompt / completion / total tokens, call count, errors, average latency). This is how you track cost per model.
- **Tool, media, and approval counters** — outcome counts for every allow-listed tool, generated images, and approval requests/grants.

### `POST /api/run/cancel`

Cancels an in-flight run:

```bash
curl -s -X POST http://localhost:3000/api/run/cancel \
  -H 'Content-Type: application/json' \
  -d '{"requestId":"<X-Request-Id of the run>"}'
# -> { "cancelled": true, "requestId": "..." }  (404 if it already finished)
```

Streaming clients do not need this: disconnecting the response aborts the model call automatically (`res` close triggers an abort, and the run emits a `cancelled` event).

## Stable Diffusion (image generation)

Agent Village ships with a **real Stable Diffusion adapter** (Automatic1111 WebUI `txt2img` API). It is provider-neutral and configured **only** through environment variables — no keys in code or the browser.

### 1. Run a Stable Diffusion API

The easiest path is Automatic1111 WebUI with the API enabled:

```bash
# example: Automatic1111 WebUI
./webui.sh --api --listen
# API is then available at http://127.0.0.1:7860
```

(ComfyUI users can point `SD_BASE_URL` at a compatible `/sdapi/v1/txt2img` endpoint.)

### 2. Configure Agent Village

```bash
# required: base URL of the SD API
export SD_BASE_URL="http://127.0.0.1:7860"
# optional: bearer token if your SD API requires one
export SD_API_KEY=""
# optional: model label for display
export SD_MODEL="stable-diffusion"
npm start
```

Check status:

```bash
curl http://localhost:3000/api/providers
```

### 3. Generate

```bash
# 1) request approval
curl -s -X POST http://localhost:3000/api/media/generate \
  -H 'Content-Type: application/json' \
  -d '{"kind":"image","prompt":"a small isometric village at dusk"}'
# -> 202 { "id": "media-...", "error": "approval required" }

# 2) approve
curl -s -X POST http://localhost:3000/api/media/approve \
  -H 'Content-Type: application/json' \
  -d '{"id":"media-..."}'

# 3) generate (approved)
curl -s -X POST http://localhost:3000/api/media/generate \
  -H 'Content-Type: application/json' \
  -d '{"kind":"image","prompt":"a small isometric village at dusk","approved":true,"id":"media-..."}'
# -> 200 { "url": "/media/image-....png", "status": "generated" }
```

Or just use the **Image studio** card in the Workbench view.

Generated files are written to `media/` (git-ignored) and served from `GET /media/<file>`.

### Video

Video generation is a documented adapter placeholder. Wire a video provider (e.g. AnimateDiff/ComfyUI or a hosted API) into `generateMedia()` behind the same server boundary and set `VIDEO_BASE_URL` + `VIDEO_PROVIDER_API_KEY`.

## LLM provider (real generation)

By default Agent Village uses the deterministic local demo router. Set an **OpenAI-compatible** LLM endpoint to get real model-generated deliverables grounded in your knowledge notes. Works with Ollama, LM Studio, Groq, OpenAI, or any `/chat/completions` API.

### Presets (one env var)

```bash
export LLM_PRESET="ollama"      # local, free, no key
export LLM_PRESET="lmstudio"    # local
export LLM_PRESET="groq"        # free tier — sign up for a key, then set LLM_API_KEY
export LLM_PRESET="gemini"      # free tier — set LLM_API_KEY
export LLM_PRESET="openrouter"  # free models — set LLM_API_KEY
export LLM_PRESET="openai"      # paid
```

`LLM_BASE_URL` / `LLM_MODEL` override any preset. List presets at `GET /api/llm/presets`.

**Honest caveats:**
- "Free" means the provider's own free tier; accounts, rate limits, and terms of service apply. Using them requires *your* key — none are bundled.
- Ollama and LM Studio are genuinely free and local, but quality and speed depend on your hardware.
- Agent Village cannot connect to Kilo directly: Kilo is a coding agent, not an inference API. If your Kilo setup exposes an OpenAI-compatible local model endpoint, point `LLM_BASE_URL` at it.
- This project cannot train or ship its own model; it orchestrates models you can reach.

```bash
# Ollama (local, free)
ollama pull llama3.1
ollama serve                     # http://127.0.0.1:11434
export LLM_BASE_URL="http://127.0.0.1:11434/v1"
export LLM_MODEL="llama3.1"
npm start
```

```bash
# LM Studio
export LLM_BASE_URL="http://127.0.0.1:1234/v1"
export LLM_MODEL="local-model"

# OpenAI or compatible hosted API
export LLM_BASE_URL="https://api.openai.com/v1"
export LLM_API_KEY="sk-..."
export LLM_MODEL="gpt-4o-mini"
```

Optional: `LLM_TEMPERATURE` (default `0.4`), `LLM_TIMEOUT_MS` (default `30000`).

- `LLM_MODEL_MAP` — JSON map of capability → model, e.g. `{"code":"qwen2.5-coder:7b","reasoning":"deepseek-r1:7b"}`. Routes each capability to a different model.
- `LLM_EMBED_MODEL` — embedding model for semantic memory (default `nomic-embed-text`). Used for `/embeddings` on the same base URL.

When configured:
- `POST /api/run` asks the LLM for JSON (deliverable, reports, verdict), validated and clamped server-side.
- Matched knowledge notes are injected into the prompt as retrieval context.
- If the LLM is unreachable or returns invalid JSON, the demo router is used as a fallback and the audit log records it.

`GET /api/providers` reports the `llm` provider and model (never the key). No keys reach the browser, and the model never modifies code.

### Streaming (SSE)

Pass `"stream": true` to `POST /api/run` to receive server-sent events:

```
event: status  data: {"phase":"model","message":"Using llama3.1 for the Planning route"}
event: status  data: {"phase":"tool","message":"calculator"}
event: result  data: { ...final result... }
```

Errors arrive as `event: error`; a consequential tool call arrives as `event: approval` (approve via `POST /api/tools/approve`, then re-run with `approvedTools: [id]`). The Workbench uses this automatically and shows live phase updates.

### Persistence

Data is stored in SQLite (`data/village.db`) via Node's built-in `node:sqlite` when available, falling back to JSON files otherwise. Tables: `feedback`, `knowledge`, `audit`, `missions`, `embeddings`.

`GET /api/missions?limit=20` returns recent runs with their capability and source.

## Tool use (allow-listed, approval-gated)

When an LLM is configured, the model can call a fixed allow-list of tools instead of guessing.

| Tool | Consequence | What it does |
|---|---|---|
| `calculator` | safe | Evaluate arithmetic (real parser, no `eval`) |
| `knowledge_search` | safe | Keyword-search stored knowledge notes |
| `knowledge_list` | safe | List all knowledge notes |
| `image_generate` | **consequential** | Generate an image with Stable Diffusion |
| `feedback_save` | **consequential** | Save a routing correction |

- Safe tools execute immediately; the result is fed back to the model, which then writes the final deliverable.
- Consequential tools return `202` with an approval id. Approve via `POST /api/tools/approve { id }`, then re-run `/api/run` with `approvedTools: [id]`. Approval is one-time and matches the exact tool + args.
- The loop is bounded to 5 model turns to prevent runaway.
- Every tool call is audited (`GET /api/audit`), and the allow-list is public via `GET /api/tools`.

## Learning and memory (what it can and cannot do)

Agent Village has **no trained model**. Routing is deterministic keyword scoring plus templates, so there is nothing to "retrain." What it supports instead is a **persistent memory layer**:

- `POST /api/feedback` — record a correction: `{ mission, expectedCapability, note? }`. The router checks learned corrections first (exact normalized mission match) before heuristic routing.
- `GET /api/feedback` — list recent corrections.
- `POST /api/knowledge` — store a note: `{ title, content }`. Matching notes are injected into deliverables as a `Knowledge` section and listed in `knowledge` on the run result.
- `GET /api/knowledge` — list stored notes.

Notes and corrections persist to SQLite (`data/village.db`) and survive restarts. When an LLM is configured, retrieval upgrades from keyword matching to **semantic search**: knowledge notes are embedded via `/embeddings` and ranked by cosine similarity (falls back to keywords if embeddings are unavailable). The **Teach the village** card in the Workbench exposes both.

### Not supported, by design

- **Model retraining** — there is no ML model in this project.
- **Autonomous code modification** — the agent never rewrites its own code. Improvements go through a reviewed Git change (`AGENT_HANDOFF.md`, `AGENTS.md`).
- **Unattended automation** — consequential actions require an explicit human approval gate.

## Docker

```bash
docker build -t agent-village .
docker run -p 3000:3000 agent-village
```

The container runs as a non-root user and exposes a health endpoint on port 3000.

### Docker Compose (with local Ollama)

```bash
docker compose up -d
docker compose exec ollama ollama pull llama3.1
```

This runs Agent Village on `http://localhost:3000` and Ollama on `:11434`, pre-wired via `LLM_PRESET=ollama`. Edit `docker-compose.yml` to add `SD_BASE_URL` when you run a Stable Diffusion service.

## Upgrade posture

Treat each accepted improvement as a checkpoint. Add new connectors behind explicit capability modules, keep user approval visible for consequential actions, and do not turn on unattended automation merely because a connector exists. See `AGENT_HANDOFF.md` and `TODO.md`.

## Roadmap (honest)

No single feature creates a breakthrough. These are the highest-leverage next steps, ranked by impact vs. risk.

| Upgrade | Why it matters | Effort | Risk |
|---|---|---|---|
| **Auth + multi-user** | Token auth for write endpoints; per-user history | M | Medium |
| **Durable workspaces** | Versioned artifacts and resumable runs that survive restarts | M | Medium |
| **Provider health probes** | Active liveness checks instead of static config flags | S | Low |

Already in place: observability (request IDs, structured JSON logs, `GET /api/metrics`), cancel/abort mid-run (`POST /api/run/cancel` plus client-disconnect abort), cost & token accounting, adversarial eval suite (`npm run eval:security`), streaming (SSE), semantic embeddings, SQLite persistence, per-capability model routing, tool use (allow-listed, approval-gated, audited), evaluation harness (`npm run eval`), injection-delimited prompts, audit trail (`GET /api/audit`), missions log (`GET /api/missions`), provider presets, approval-gated media, and feedback/knowledge memory.

## Security

- Static file serving rejects path traversal (`..` segments) and serves only regular files inside `public/` and `media/`.
- All responses send `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Content-Security-Policy`.
- Request bodies are capped at 20 KB.
- No browser-side API keys or secrets. Provider credentials are read from environment variables only.
- Media generation requires an explicit human approval gate.
