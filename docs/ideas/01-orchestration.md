# Orchestration and planning — 100 ideas

How work is decomposed, routed, verified, and recovered inside a run. Most rows touch
`lib/orchestrator.mjs` or `lib/workflow.mjs`; UI rows also touch `public/app.js`.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| ORCH-001 | Persist the plan artifact | Store the Planner's JSON plan as a first-class run artifact instead of a transient event | `lib/orchestrator.mjs`, `lib/store.mjs` | S | AN/agents |
| ORCH-002 | Plan approval gate | Optional hold after planning so a human can edit or approve steps before execution | `server.mjs`, `public/app.js` | M | LANGGRAPH |
| ORCH-003 | Plan diff on replan | Render a step-by-step diff whenever the Planner replaces an earlier plan | `public/app.js` | S | Invented |
| ORCH-004 | Verifier-triggered replan | Re-enter planning with the verifier's failure reasons instead of failing the run | `lib/orchestrator.mjs` | M | AN/agents |
| ORCH-005 | Failure taxonomy feedback | Classify failures as bad plan, bad args, tool error, or bad evidence and route each differently | `lib/orchestrator.mjs`, `lib/verifier.mjs` | M | AN/evals |
| ORCH-006 | Reflexion retry | On retry, prepend a short verbal lesson from the failed attempt, capped at one paragraph | `lib/orchestrator.mjs` | S | REFLEXION |
| ORCH-007 | Step retry policy | Per-step retry counts, backoff, and retryable-error matching declared in the plan schema | `lib/workflow.mjs` | S | TEMPORAL |
| ORCH-008 | Independent-step batching | Detect steps with no data dependency and execute them concurrently within a batch | `lib/workflow.mjs` | M | AN/agents |
| ORCH-009 | Parallel recon fan-out | Split Scout into 2–4 focused sub-scouts when the mission spans multiple domains | `lib/orchestrator.mjs`, `lib/agents.mjs` | M | AN/multiagent |
| ORCH-010 | Orchestrator-worker subagents | Spawn bounded worker agents with their own context and a single deliverable each | `lib/orchestrator.mjs` | L | AN/multiagent |
| ORCH-011 | Context isolation per worker | Give each subagent only the evidence slice it needs, never the whole transcript | `lib/orchestrator.mjs` | M | AN/context |
| ORCH-012 | Typed subagent returns | Require workers to return summary, evidence refs, open questions, and confidence | `lib/agents.mjs` | S | AN/multiagent |
| ORCH-013 | Standard handoff note | One schema for phase-to-phase handoffs so no phase depends on chat history | `lib/orchestrator.mjs` | S | AN/managed |
| ORCH-014 | Explicit phase gates | Declare entry and exit criteria per phase and refuse to advance without them | `lib/orchestrator.mjs` | M | AN/harness |
| ORCH-015 | Evidence-gated transitions | Require at least one tool-result citation before synthesis can start | `lib/orchestrator.mjs`, `lib/verifier.mjs` | S | AN/evals |
| ORCH-016 | Definition of done generator | Derive acceptance criteria from the mission before planning and show them in the UI | `lib/orchestrator.mjs` | M | AN/harness |
| ORCH-017 | Synthesized acceptance tests | Turn the definition of done into deterministic checks the Verifier can run | `lib/verifier.mjs` | L | AN/harness |
| ORCH-018 | Clarify before plan | Ask up to three ranked clarification questions when ambiguity is high | `lib/orchestrator.mjs`, `public/app.js` | M | OPENAI/agents |
| ORCH-019 | Ambiguity budget | A numeric allowance for unresolved ambiguity per phase, surfaced in the UI | `lib/orchestrator.mjs` | S | Invented |
| ORCH-020 | Assumption ledger | Record every assumption with the step that depends on it and a falsification test | `lib/orchestrator.mjs` | S | Invented |
| ORCH-021 | Open questions ledger | Track unresolved questions across phases and block synthesis on critical ones | `lib/store.mjs`, `public/app.js` | M | Invented |
| ORCH-022 | Decision log | Append one ADR-style record per consequential choice: options, reason, reversibility | `lib/store.mjs` | S | Invented |
| ORCH-023 | Alternatives considered | Require the Planner to list one rejected alternative per major step | `lib/agents.mjs` | S | Invented |
| ORCH-024 | Reversibility classes | Label each step reversible, compensable, or irreversible before execution | `lib/policy.mjs` | M | OPENAI/agents |
| ORCH-025 | Policy engine for approvals | Declarative rules mapping risk class plus user role to allow, ask, or deny | `lib/policy.mjs` | L | OPENAI/agents |
| ORCH-026 | Risk-tiered tool grants | Tools get risk tiers; phases inherit only the tiers they need | `lib/tools.mjs`, `lib/policy.mjs` | M | OPENAI/agents |
| ORCH-027 | Per-phase capability allowlist | Planner cannot schedule a tool outside the phase's allowlist | `lib/orchestrator.mjs` | S | AN/agents |
| ORCH-028 | Dynamic role activation | Only instantiate roles the plan actually needs to cut token and latency cost | `lib/orchestrator.mjs` | M | AN/agents |
| ORCH-029 | Role-specific context packs | Each role gets a tailored context template rather than one shared prompt blob | `lib/agents.mjs` | M | AN/context |
| ORCH-030 | Agent retirement | Stop routing to a role after repeated failures until a probe succeeds | `lib/orchestrator.mjs` | S | K8S |
| ORCH-031 | Agent health score | Rolling success, latency, and schema-validity score per role and provider | `lib/metrics.mjs` | M | OBS |
| ORCH-032 | Per-agent circuit breakers | Reuse the provider breaker per role so one bad prompt cannot sink every run | `lib/llm.mjs` | M | AN/agents |
| ORCH-033 | Budget-aware routing | Choose the cheapest model that clears the role's quality threshold | `lib/routing/free-first.mjs` | M | AN/agents |
| ORCH-034 | Pre-run cost estimate | Estimate token and wall-clock cost from the plan before spending anything | `lib/budget.mjs` | M | Invented |
| ORCH-035 | Phase token budgets | Allocate a token budget per phase and fail soft when a phase overspends | `lib/budget.mjs` | S | AN/context |
| ORCH-036 | Deadline propagation | Carry a run deadline into every step and shrink downstream timeouts accordingly | `lib/workflow.mjs` | M | TEMPORAL |
| ORCH-037 | Per-step timeout budget | Each node declares its own timeout; the engine enforces it with abort signals | `lib/workflow.mjs` | S | TEMPORAL |
| ORCH-038 | Loop and step limits | Hard caps per run plus repeated-state detection to stop infinite replanning | `lib/orchestrator.mjs` | S | OPENAI/agents |
| ORCH-039 | Stagnation detector | Detect when successive iterations add no new evidence or claims | `lib/orchestrator.mjs` | M | REFLEXION |
| ORCH-040 | Progress metric | Compute percent of acceptance criteria satisfied after each phase | `lib/orchestrator.mjs` | M | AN/harness |
| ORCH-041 | Coverage metric | Track which mission sub-questions have at least one supporting source | `lib/verifier.mjs` | M | RAG |
| ORCH-042 | Critical-path scheduler | Order ready nodes by longest downstream chain to reduce wall-clock time | `lib/workflow.mjs` | M | TEMPORAL |
| ORCH-043 | Run priority queue | Queue runs by user tier and deadline; expose position and ETA | `server.mjs` | M | K8S |
| ORCH-044 | Fair scheduling | Round-robin or weighted fairness so one user cannot starve the queue | `server.mjs` | M | K8S |
| ORCH-045 | Work stealing | Idle workers pull ready nodes from other runs when their own run is blocked | `lib/workflow.mjs` | L | K8S |
| ORCH-046 | Idempotent node keys | Key each node by run, plan hash, node id, and args hash for safe retries | `lib/store.mjs` | S | TEMPORAL |
| ORCH-047 | Intra-run dedupe | Collapse identical tool calls issued by different steps in the same run | `lib/tools.mjs` | S | Invented |
| ORCH-048 | Tool result memoization | Cache pure tool results with a TTL and a cache key derived from normalized args | `lib/tools.mjs` | M | INNGEST |
| ORCH-049 | Speculative next step | Start the most likely next pure step while the current step is still finishing | `lib/workflow.mjs` | L | Invented |
| ORCH-050 | Speculation cancellation | Abort speculative work as soon as the real branch diverges | `lib/workflow.mjs` | M | TEMPORAL |
| ORCH-051 | Beam search over plans | Generate several candidate plans, score cheaply, and execute the best | `lib/orchestrator.mjs` | L | Invented |
| ORCH-052 | Plan scoring rubric | Score plans for feasibility, cost, evidence coverage, and risk before choosing | `lib/agents.mjs` | M | AN/evals |
| ORCH-053 | Planner critic pass | A cheap Critic reviews the plan for missing steps before execution | `lib/critic.mjs` | S | AN/agents |
| ORCH-054 | Two-planner debate | Two planners propose independently; a judge merges the stronger steps | `lib/orchestrator.mjs` | M | Invented |
| ORCH-055 | Mixture-of-agents synthesis | Sample several reviewers and synthesize a consensus answer with disagreement notes | `lib/synthesizer.mjs` | M | AN/agents |
| ORCH-056 | Self-consistency voting | For classification steps, sample k times and take the calibrated majority | `lib/verifier.mjs` | M | AN/evals |
| ORCH-057 | Confidence-weighted aggregation | Weight votes by each agent's historical calibration rather than raw counts | `lib/orchestrator.mjs` | M | Invented |
| ORCH-058 | Quorum rules | Require a minimum number of independent confirmations for high-risk claims | `lib/policy.mjs` | S | Invented |
| ORCH-059 | Dissent recording | Preserve minority opinions in the final report instead of averaging them away | `lib/synthesizer.mjs` | S | Invented |
| ORCH-060 | Deterministic tie-break | Fixed rule for tied votes, with the tie surfaced as an explicit caveat | `lib/orchestrator.mjs` | S | AN/evals |
| ORCH-061 | Debate moderator | A moderator enforces turn order, evidence requirements, and stopping rules | `lib/orchestrator.mjs` | M | Invented |
| ORCH-062 | Debate stopping rule | Stop debate when the last round added no new claims or evidence | `lib/orchestrator.mjs` | S | Invented |
| ORCH-063 | Marginal-information stopping | Stop gathering when expected information gain falls below cost | `lib/scout.mjs` | L | Invented |
| ORCH-064 | Mid-run steering | Accept a user message during a run and inject it at the next safe phase boundary | `server.mjs`, `lib/orchestrator.mjs` | M | LANGGRAPH |
| ORCH-065 | Phase-boundary pause | Pause exactly between phases so state is consistent and resumable | `lib/orchestrator.mjs` | S | TEMPORAL |
| ORCH-066 | Approval queue | Server-side queue of pending approvals with assignee, risk, and expiry | `server.mjs` | M | OPENAI/agents |
| ORCH-067 | Approval expiry | Expired approvals fail closed and mark the run as needing human review | `lib/orchestrator.mjs` | S | INNGEST |
| ORCH-068 | Escalation ladder | Agent, then supervisor agent, then human, with explicit triggers at each rung | `lib/orchestrator.mjs` | M | OPENAI/agents |
| ORCH-069 | Incident commander role | On repeated failure, one role owns diagnosis, mitigation, and the final report | `lib/agents.mjs` | M | K8S |
| ORCH-070 | Runbook selection | Match failures to a library of remediation runbooks by signature | `lib/orchestrator.mjs` | M | K8S |
| ORCH-071 | Fallback plan | Precompute a minimal safe plan for when the primary plan cannot proceed | `lib/orchestrator.mjs` | M | TEMPORAL |
| ORCH-072 | Degraded mode | Serve partial results with a clear banner when optional capabilities fail | `server.mjs` | S | K8S |
| ORCH-073 | Dry-run mode | Execute planning and validation but suppress all side-effecting tools | `lib/policy.mjs` | M | OPENAI/agents |
| ORCH-074 | Shadow comparison | Run the same mission against a second model and diff outputs without showing users | `lib/orchestrator.mjs` | L | AN/evals |
| ORCH-075 | Prompt A/B assignment | Sticky assignment of prompt variants per user for controlled experiments | `lib/orchestrator.mjs` | M | AN/evals |
| ORCH-076 | Capability flags | Feature-flag individual phases and tools for staged rollout | `server.mjs` | S | K8S |
| ORCH-077 | Deterministic orchestration seed | One seed controls sampling, tie-breaks, and scheduling for reproducible runs | `lib/orchestrator.mjs` | M | AN/evals |
| ORCH-078 | Replayable decisions | Log every branch decision with inputs so a run can be reconstructed exactly | `lib/store.mjs` | M | TEMPORAL |
| ORCH-079 | Config snapshot per run | Persist prompts, model ids, temperatures, and tool versions with the run | `lib/store.mjs` | S | AN/evals |
| ORCH-080 | Prompt version pinning | Runs reference immutable prompt versions instead of reading live constants | `lib/agents.mjs` | M | LANGFUSE |
| ORCH-081 | Model version pinning | Pin exact provider model ids and warn when the provider silently changes aliases | `lib/llm.mjs` | S | AN/evals |
| ORCH-082 | Capability probe | Before planning, probe which tools and providers are actually available | `server.mjs` | S | MCP |
| ORCH-083 | Tool discovery phase | Spend a bounded step discovering relevant tools before committing to a plan | `lib/orchestrator.mjs` | M | AN/tools |
| ORCH-084 | Tool search in prompt | Let the Planner search a tool index instead of stuffing every schema into context | `lib/tools.mjs` | M | AN/tools |
| ORCH-085 | Tool shortlist | Rank tools by mission fit and include only the top-k with examples | `lib/tools.mjs` | S | AN/tools |
| ORCH-086 | Lazy schema loading | Load full tool schemas only when a tool is selected | `lib/tools.mjs` | M | AN/tools |
| ORCH-087 | Programmatic tool step | A plan step may compose several tool calls in a safe expression language | `lib/tools.mjs` | L | AN/tools |
| ORCH-088 | Sandboxed composition DSL | A tiny, auditable DSL for tool composition with no network or filesystem escapes | `lib/workflow.mjs` | L | AN/code-mcp |
| ORCH-089 | Result summarization before handoff | Compress large tool outputs to a bounded evidence card before the next role | `lib/orchestrator.mjs` | M | AN/context |
| ORCH-090 | Phase compaction | Summarize completed phases and drop raw turns before the next phase | `lib/orchestrator.mjs` | M | AN/context |
| ORCH-091 | Structured scratchpad | A typed notes object the agent can read and write across steps | `lib/store.mjs` | S | AN/context |
| ORCH-092 | Archivist-maintained recap | Archivist produces the rolling run recap instead of the executing model | `lib/archivist.mjs` | M | AN/memory |
| ORCH-093 | Phase recap cards | One compact card per phase with goal, result, evidence, and unresolved items | `public/app.js` | S | AN/context |
| ORCH-094 | Run narrative | A readable end-to-end story of the run generated from events, not raw logs | `lib/chronicle.mjs` | M | Invented |
| ORCH-095 | Provenance threading | Every claim keeps a pointer to the tool call and evidence span that produced it | `lib/orchestrator.mjs` | M | RAG |
| ORCH-096 | Shared evidence table | A single deduplicated table of sources, snippets, and trust scores for all roles | `lib/store.mjs` | M | RAG |
| ORCH-097 | Claim verification matrix | Grid of claims by supporting and contradicting evidence with a verdict per cell | `lib/verifier.mjs` | M | Invented |
| ORCH-098 | Confidence propagation | Fuse step confidences into a final calibrated confidence with an explanation | `lib/orchestrator.mjs` | M | Invented |
| ORCH-099 | Verifier synthesis | Generate deterministic checks from a few examples of desired outputs | `lib/verifier.mjs` | L | AN/harness |
| ORCH-100 | Retrospective and lessons | After each run, extract lessons, update playbooks, and emit a regression test when possible | `lib/orchestrator.mjs`, `lib/archivist.mjs` | M | REFLEXION |
