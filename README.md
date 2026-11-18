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

## Learning and memory (what it can and cannot do)

Agent Village has **no trained model**. Routing is deterministic keyword scoring plus templates, so there is nothing to "retrain." What it supports instead is a **persistent memory layer**:

- `POST /api/feedback` — record a correction: `{ mission, expectedCapability, note? }`. The router checks learned corrections first (exact normalized mission match) before heuristic routing.
- `GET /api/feedback` — list recent corrections.
- `POST /api/knowledge` — store a note: `{ title, content }`. Matching notes are injected into deliverables as a `Knowledge` section and listed in `knowledge` on the run result.
- `GET /api/knowledge` — list stored notes.

Notes and corrections persist to `data/feedback.json` and `data/knowledge.json` (git-ignored) and survive restarts. The **Teach the village** card in the Workbench exposes both.

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

## Upgrade posture

Treat each accepted improvement as a checkpoint. Add new connectors behind explicit capability modules, keep user approval visible for consequential actions, and do not turn on unattended automation merely because a connector exists. See `AGENT_HANDOFF.md` and `TODO.md`.

## Security

- Static file serving rejects path traversal (`..` segments) and serves only regular files inside `public/` and `media/`.
- All responses send `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Content-Security-Policy`.
- Request bodies are capped at 20 KB.
- No browser-side API keys or secrets. Provider credentials are read from environment variables only.
- Media generation requires an explicit human approval gate.
