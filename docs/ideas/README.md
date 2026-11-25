# 1,040 upgrade ideas for Agent Village

A researched backlog of concrete things to add to this repository. Every row names the
file it would touch, a rough effort, and where the idea came from. The catalog is
deliberately broader than GitHub: lab playbooks, protocol specs, memory systems,
observability standards, security guidance, simulation projects, and product UX
research. 179 rows are original mechanisms marked **Invented**.

**Start here:** [Top 50 roadmap](#top-50-roadmap) · [First week](#first-week) ·
[Category map](#category-map) · [How to read a row](#how-to-read-a-row)

```bash
npm run ideas:check   # validates ids, counts, columns, sources, and title totals
```

## What this is

- A prioritized menu, not a rewrite plan. Each idea is scoped to fit the existing
  zero-dependency, Node 20+, server-only-seam architecture.
- A quality bar: ideas must be testable, reversible, and useful to a real user. Rows
  that only add ceremony or vendor lock-in were left out.
- A source trail. `SOURCES.md` expands every key and explains what it contributed.

## What this is not

- Not permission to add shell execution, arbitrary file writes, browser-side secrets,
  or unattended consequential actions. Those remain out of contract.
- Not a dependency wishlist. Optional backends and connectors must sit behind an
  interface and stay optional in the default install.
- Not a commitment to build all 1,040. It is a map for choosing the next 10.

## How to read a row

```text
| ORCH-006 | Reflexion retry | On retry, prepend a short verbal lesson ... | lib/orchestrator.mjs | S | REFLEXION |
```

| Column | Meaning |
|---|---|
| ID | Stable id: category prefix plus a zero-padded number. Use it in issues and PR titles. |
| Idea | Short name. |
| What it adds | The behavior, mechanism, or guarantee. |
| Where | The file or directory expected to change. |
| Effort | **S** under a day, **M** one to three days, **L** more than three days for one experienced contributor. |
| Source | A key from `SOURCES.md`, or **Invented** for an original mechanism. |

## Category map

| File | Prefix | Ideas | Focus |
|---|---|---:|---|
| [01-orchestration.md](01-orchestration.md) | ORCH | 100 | Planning, routing, debate, verification, recovery |
| [02-durability.md](02-durability.md) | DUR | 80 | Journals, checkpoints, effects, timers, storage lifecycle |
| [03-memory.md](03-memory.md) | MEM | 90 | Retrieval, consolidation, contradiction, forgetting, graph |
| [04-models-context.md](04-models-context.md) | LLM | 90 | Providers, prompts, schemas, budgets, multimodal |
| [05-tools-mcp.md](05-tools-mcp.md) | TOOL | 90 | Tool contracts, guards, connectors, MCP |
| [06-security.md](06-security.md) | SEC | 100 | Injection, authz, supply chain, privacy, incident response |
| [07-evaluation.md](07-evaluation.md) | EVAL | 90 | Trajectory grading, statistics, fault injection, CI gates |
| [08-observability.md](08-observability.md) | OBS | 80 | Traces, metrics, SLOs, timelines, operator views |
| [09-api-protocols.md](09-api-protocols.md) | API | 80 | Versioning, errors, SSE, webhooks, A2A, AG-UI, MCP |
| [10-ux.md](10-ux.md) | UX | 90 | Trust, control, accessibility, artifacts, responsiveness |
| [11-town.md](11-town.md) | TOWN | 70 | Deterministic simulation, economy, governance, culture |
| [12-novel.md](12-novel.md) | NOVEL | 80 | Original differentiators and experiments |
| **Total** | | **1,040** | 472 small, 484 medium, 84 large |

## Top 50 roadmap

Ordered in five waves. Each wave makes the next one cheaper: durability before
measurement, measurement before optimization, optimization before autonomy.

### Wave 1 — Make every run explainable (10)

| # | ID | Outcome |
|---:|---|---|
| 1 | DUR-001 | Append-only journal, so a crash cannot lose the story of a run |
| 2 | DUR-030 | Heartbeats, so the server can tell "working" from "dead" |
| 3 | DUR-031 | Crash detection on boot marks interrupted runs honestly |
| 4 | DUR-003 | Named checkpoints make resume and incident review practical |
| 5 | ORCH-014 | Explicit phase gates stop silent partial success |
| 6 | ORCH-095 | Provenance threading connects every claim to its evidence |
| 7 | OBS-001 | One trace per run, with phase and tool spans |
| 8 | OBS-060 | A run timeline a non-author can read in 30 seconds |
| 9 | API-005 | RFC 9457 errors so clients stop parsing prose |
| 10 | SEC-001 | A reviewed threat model with assets and trust boundaries |

### Wave 2 — Make quality measurable (10)

| # | ID | Outcome |
|---:|---|---|
| 11 | EVAL-004 | Grade the trajectory, not just the final paragraph |
| 12 | EVAL-019 | pass@k for exploration tasks |
| 13 | EVAL-020 | pass^k for reliability-sensitive tasks |
| 14 | EVAL-021 | Report variance instead of one lucky run |
| 15 | EVAL-041 | A regression gate that fails PRs on real drops |
| 16 | EVAL-042 | Fast canary suite per push, full suite nightly |
| 17 | EVAL-053 | A shared failure taxonomy for triage |
| 18 | MEM-068 | A labeled retrieval set with recall and precision targets |
| 19 | ORCH-006 | Reflexion retry turns a failure into a lesson |
| 20 | ORCH-052 | Plan scoring catches bad plans before execution |

### Wave 3 — Spend context like money (10)

| # | ID | Outcome |
|---:|---|---|
| 21 | MEM-001 | Hybrid BM25 plus vector retrieval |
| 22 | MEM-008 | Metadata filters before ranking |
| 23 | MEM-009 | User, project, run, and global scopes |
| 24 | MEM-011 | TTLs so stale trivia does not live forever |
| 25 | MEM-016 | Near-duplicate collapse at write time |
| 26 | MEM-034 | Token-budget packing with a knapsack |
| 27 | ORCH-084 | Tool search instead of stuffing every schema |
| 28 | ORCH-086 | Lazy schema loading for selected tools only |
| 29 | LLM-006 | Preflight context-overflow guard |
| 30 | LLM-018 | Schema enforcement on every structured role |

### Wave 4 — Make autonomy earned (10)

| # | ID | Outcome |
|---:|---|---|
| 31 | ORCH-024 | Label steps reversible, compensable, or irreversible |
| 32 | ORCH-025 | A policy engine mapping risk and role to allow, ask, deny |
| 33 | ORCH-066 | A real approval queue with owners and expiry |
| 34 | SEC-006 | Deny-by-default for tools, routes, providers, scopes |
| 35 | SEC-050 | MCP tool hash pinning and re-approval on change |
| 36 | TOOL-033 | SSRF guard for every outbound call |
| 37 | TOOL-034 | Per-domain allowlist with policy |
| 38 | SEC-093 | A kill switch that stops all runs |
| 39 | NOVEL-006 | Blast-radius preview before approval |
| 40 | UX-066 | Approval diff showing exactly what changes |

### Wave 5 — Build what others do not have (10)

| # | ID | Outcome |
|---:|---|---|
| 41 | NOVEL-003 | Regret ledger: which decisions would you reverse? |
| 42 | NOVEL-004 | Counterfactual replay with side-by-side outcomes |
| 43 | NOVEL-005 | Trust budget: autonomy grows with clean runs |
| 44 | NOVEL-022 | An explorable evidence graph, not a wall of links |
| 45 | TOWN-002 | A drift-corrected tick scheduler |
| 46 | TOWN-068 | External A2A agents can register as citizens |
| 47 | API-045 | A real A2A Agent Card |
| 48 | API-057 | MCP over streamable HTTP |
| 49 | UX-069 | A live budget meter users can trust |
| 50 | NOVEL-070 | Review queue ordered by risk times uncertainty |

## First week

If only ten things ship this week, ship these. They are all **S** or small **M**, and
they compound.

1. `DUR-030` run heartbeat
2. `DUR-031` crash detection on boot
3. `ORCH-014` phase gates
4. `OBS-060` run timeline
5. `API-005` Problem Details errors
6. `EVAL-053` failure taxonomy
7. `MEM-001` hybrid retrieval
8. `TOOL-033` SSRF guard
9. `UX-069` budget meter
10. `SEC-001` threat model

## Selection criteria

Every row was judged against five questions:

1. **Would a user notice?** If the answer is no, it belongs in a refactor ticket.
2. **Is it testable without a paid provider?** The mock provider and fixtures make this
   possible for almost everything here.
3. **Does it preserve the contract?** No shell, no arbitrary writes, no browser secrets,
   no unattended consequential actions.
4. **Is it reversible?** Prefer flags, additive routes, and optional adapters.
5. **Does it teach the system something?** Logs, scores, and evals that create a
   feedback loop rank above features that only add surface area.

## Working with these ideas

- One idea per branch and PR. Use the id in the title, for example
  `feat(ORCH-006): add reflexion retry with a stored lesson`.
- Add a test before the implementation. For docs-only changes, run
  `npm run ideas:check`.
- Update the row only when the behavior that ships differs from the description.
- Keep `SOURCES.md` honest: add a key before citing it, and mark original ideas
  **Invented**.
- If an idea needs a dependency to be useful, first write the interface and the
  no-dependency default. Optional adapters are allowed; mandatory ones are not.

## Provenance

Research was collected from primary sources between November 2025 and November 2026:
Anthropic engineering and research posts, the MCP 2025-06-18 specification, A2A,
AG-UI, OpenTelemetry GenAI conventions, OWASP LLM guidance, Temporal/LangGraph/
Inngest/Restate documentation, memory systems (Letta, Mem0, Zep, Cognee), evaluation
tooling (Inspect AI, Langfuse, Phoenix), simulation projects (Generative Agents,
Emergent City, OpenWants), and UX guidance (NN/g, WCAG 2.2, Canva, Figma). Source
quality varies; the catalog favors mechanisms that can be reimplemented from the
description rather than product-specific behavior.
