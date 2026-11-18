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
`GET /` serves `public/index.html`. `GET /manus-routes.json` serves the route manifest.

## Docker

```bash
docker build -t agent-village .
docker run -p 3000:3000 agent-village
```

The container runs as a non-root user and exposes a health endpoint on port 3000.

## Upgrade posture

Treat each accepted improvement as a checkpoint. Add new connectors behind explicit capability modules, keep user approval visible for consequential actions, and do not turn on unattended automation merely because a connector exists. See `AGENT_HANDOFF.md` and `TODO.md`.

## Security

- Static file serving rejects path traversal (`..` segments) and serves only regular files inside `public/`.
- All responses send `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Content-Security-Policy`.
- Request bodies are capped at 20 KB.
- No browser-side API keys or secrets.
