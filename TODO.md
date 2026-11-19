# Agent Village web outcomes

## Public managed web version
- Serve Agent Village on the managed web runtime with a working home route and `/manus-routes.json`.
- Keep the Town/Station interface, capability routing, visible activity trail, structured deliverables, and safe server boundary.

## Inspiration translated into product behavior
- Use a single conversational task entry point with editable, inspectable output.
- Show plan/activity/provenance rather than a black-box response.
- Keep pause, review, override, and recovery points visible before future external actions.
- Keep visual language distinct: isometric village + dark workflow canvas, not copied branding.

## Continuous upgrade path
- Add managed LLM, image, speech, storage, and database connectors behind the server boundary.
- Add durable workspaces and versioned artifacts.
- Add provider health/status and user-controlled approval policies.
- Publish each accepted upgrade as a checkpoint; do not silently enable unattended automation.

## Done (recent checkpoints)
- Observability: request IDs (`X-Request-Id`), structured JSON request logs, `GET /api/metrics` (requests, routes, capabilities, tokens, tools, media, approvals, uptime).
- Cancel / abort mid-run: `POST /api/run/cancel` plus automatic abort when a streaming client disconnects.
- Cost & token accounting: per-completion `usage` accumulated into `/api/metrics`.
- Adversarial eval suite: `eval/adversarial.json` + `npm run eval:security` (7 prompt-injection cases).
