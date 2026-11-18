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

## Supervised code evolution

The code-evolution API accepts proposed unified diffs and stores them for review; it does not execute patches or write source files. Every proposal is authenticated with `MODEL_GATE_TOKEN`, limited to allowlisted `studio/`, `public/`, `test/`, and `docs/` paths, and checked for path traversal, sensitive paths, binary content, and patch/header mismatches.

- `GET /api/evolution/proposals` lists stored proposals.
- `POST /api/evolution/proposals` accepts `{ "mission", "rationale", "files", "patch", "author" }`.
- `POST /api/evolution/review` accepts `{ "proposalId", "decision": "approve" | "reject", "reviewer", "note" }`.

An approval means **approved for manual application only**. It is not a claim that the patch is correct, secure, or tested. A maintainer must inspect the diff, apply it on a separate Git branch, run the full checks, and open a pull request. The service never merges or deploys code.

## Learning and model training boundary

The existing learning loop stores feedback and human-approved prompt guidance; it does not change model weights. Fine-tuning is not enabled by this API. Before any future training pipeline is added, build a consent-aware dataset review/export step, benchmark candidate models against a fixed baseline, and require explicit human promotion and rollback.
