# Agent Village

Agent Village is a managed web workspace for open-ended AI work. It combines a visual Town view with a Station workflow view, routes tasks into specialist modes, and returns inspectable deliverables.

The first managed release is intentionally provider-neutral. It runs a local demo router behind the server boundary. Future upgrades can add Manus LLM, image, speech, storage, database, scheduling, and video-provider adapters without exposing secrets in the browser.

## Development

```bash
npm run check
npm start
```

The runtime listens on `PORT` and defaults to 3000. The frontend is served from `public/`. The API exposes `/api/health`, `/api/capabilities`, and `POST /api/run`.

## Upgrade posture

Treat each accepted improvement as a checkpoint. Add new connectors behind explicit capability modules, keep user approval visible for consequential actions, and do not turn on unattended automation merely because a connector exists.
