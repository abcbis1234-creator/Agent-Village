# Contributing to Agent Village

Thank you for wanting to improve Agent Village. Please read `AGENT_HANDOFF.md` and `AGENTS.md` first — they define the contribution contract and boundary.

## Before you contribute

- Read `AGENT_HANDOFF.md` (runtime contract and upgrade rules).
- Read `AGENTS.md` (contributor guidance, do-not-do list, review checklist).
- Work on a branch off `main`; never push directly to `main`.
- State scope, changed files, tests run, known limitations, and whether you add a new connector.

## What is welcome

- Bug fixes to `server.mjs` or `public/` files.
- Tests under `test/` for new or changed behavior.
- Documentation improvements in `README.md`, `AGENTS.md`, `AGENT_HANDOFF.md`.
- New capability modules behind the server boundary in `server.mjs`.

## What is not welcome

- Browser-side secrets, API keys, or credentials.
- Shell execution, arbitrary file writes, or publishing rights.
- Weakening `staticFile` path guards or security headers in `server.mjs`.
- Unattended automation or provider lock-in exposed to the frontend.

## Checks

```bash
npm run check   # syntax-check server.mjs and public/app.js
npm test        # run the Node built-in test suite under test/
```

Both must pass before a PR is reviewed.

## Pull requests

Open a PR from your branch. A maintainer reviews the diff, runs the checks, and decides whether to merge and publish a checkpoint.
