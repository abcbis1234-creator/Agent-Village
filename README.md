# Agent Village

Agent Village is a managed web workspace for open-ended AI work. It combines a visual Town view, a Station workflow view, and a Workbench for plan review, live activity, confidence, pause/approve controls, and safe handoff to another AI.

The first managed release is intentionally provider-neutral. It runs a local demo router behind the server boundary. Future upgrades can add Manus LLM, image, speech, storage, database, scheduling, and video-provider adapters without exposing secrets in the browser.

Other AI systems can contribute through the reviewed Git workflow or the bounded `GET /api/agent-contract` and `POST /api/run` interfaces. They do not receive publishing, shell, secret, or arbitrary write access by default. See `AGENT_HANDOFF.md`.

## Development

```bash
npm run check
npm start
```

The runtime listens on `PORT` and defaults to 3000. The frontend is served from `public/`. The API exposes `/api/health`, `/api/capabilities`, and `POST /api/run`.

## Upgrade posture

Treat each accepted improvement as a checkpoint. Add new connectors behind explicit capability modules, keep user approval visible for consequential actions, and do not turn on unattended automation merely because a connector exists.
