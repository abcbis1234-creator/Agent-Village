# Agent handoff contract

Yes, other AI systems can upgrade Agent Village, but they should contribute through a controlled boundary rather than receive unrestricted production access.

## Preferred path: reviewed Git contribution

Give the other AI a task brief, the project repository, the current branch/commit, and the acceptance criteria. It should create a branch or patch, run the project checks, and return a concise change summary. A human or trusted maintainer reviews the diff, merges it into `main`, and publishes a checkpoint.

## Runtime path: structured task contract

The site exposes `GET /api/agent-contract`, `GET /api/capabilities`, and `POST /api/run`. An external agent may submit a bounded mission and receive `capability`, `deliverable`, `reports`, and `verdict`. The contract does not grant shell access, secrets, publishing rights, or arbitrary file writes.

## Upgrade rules

Every external contribution must state its scope, changed files, tests run, known limitations, and whether it adds a new connector. Provider credentials stay server-side. Consequential actions require an explicit approval gate. Publication remains a separate reviewed checkpoint.
