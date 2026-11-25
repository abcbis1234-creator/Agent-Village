# Invented differentiators — 80 ideas

Original mechanisms that are not a restatement of an existing product feature. Each is
small enough to prototype behind a flag, and each creates a signal the repo does not
currently capture. Treat this file as the experimental backlog.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| NOVEL-001 | Memory weather | Visualize decay, freshness, and contradiction pressure as weather over the town | `public/app.js` | M | Invented |
| NOVEL-002 | Dream report | After a consolidation pass, publish what was merged, corrected, and forgotten | `lib/archivist.mjs` | S | AN/memory |
| NOVEL-003 | Regret ledger | Record decisions the operator would reverse and compute a regret rate per agent | `lib/store.mjs` | M | Invented |
| NOVEL-004 | Counterfactual replay | Fork at a checkpoint, change one decision, and show both outcomes side by side | `lib/orchestrator.mjs` | L | Invented |
| NOVEL-005 | Trust budget | Autonomy is a spendable balance that grows with clean runs and shrinks on incidents | `lib/policy.mjs` | M | Invented |
| NOVEL-006 | Blast-radius preview | Before an action, show every artifact, user, and external system it can touch | `lib/policy.mjs` | M | Invented |
| NOVEL-007 | Mission insurance | Require a verification plan up front and report whether the plan was honored | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-008 | Assumption triggers | Each assumption gets an observable trigger that invalidates it automatically | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-009 | Question budget | Cap clarifications at N and rank them by expected information gain | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-010 | Ambiguity heatmap | Highlight the spans of a mission that drive the most plan uncertainty | `public/app.js` | M | Invented |
| NOVEL-011 | Instruction impact score | Estimate how much an instruction edit changes outputs before it ships | `eval/` | L | Invented |
| NOVEL-012 | Token futures | Reserve budget per phase and let phases trade unused tokens within a run | `lib/budget.mjs` | M | Invented |
| NOVEL-013 | Skill card extraction | Turn a successful run into a reusable, versioned skill card | `lib/archivist.mjs` | M | VOYAGER |
| NOVEL-014 | Failure museum | A browsable collection of real failures with replayable traces | `public/app.js` | M | Invented |
| NOVEL-015 | Near-miss detector | Flag runs that almost violated a policy even though they passed | `lib/security.mjs` | M | Invented |
| NOVEL-016 | Canary missions | Synthetic missions that exercise critical paths on a schedule | `server.mjs` | M | K8S |
| NOVEL-017 | Synthetic user personas | Personas with different goals and patience for clarifying questions | `eval/` | M | Invented |
| NOVEL-018 | Adversarial twin | A second agent tries to break each plan before execution | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-019 | Decision courtroom | Prosecutor, defender, and judge agents argue a contested decision | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-020 | Dissent ledger | Preserve minority views with the evidence behind them, permanently | `lib/store.mjs` | S | Invented |
| NOVEL-021 | Uncertainty bands | Show a range instead of a point for numeric and factual claims | `public/app.js` | M | Invented |
| NOVEL-022 | Evidence graph | A graph of claims, sources, and support relations that users can explore | `public/app.js` | L | Invented |
| NOVEL-023 | Claim ledger | Every claim gets an id, status, evidence, and verification history | `lib/verifier.mjs` | M | Invented |
| NOVEL-024 | Source reliability ledger | Track how often a source was later contradicted and adjust trust | `lib/archivist.mjs` | M | Invented |
| NOVEL-025 | Citation drift detector | Detect when a cited page changed since the citation was captured | `lib/verifier.mjs` | M | Invented |
| NOVEL-026 | Contradiction timeline | Show when beliefs changed and which evidence caused each change | `public/app.js` | M | ZEP |
| NOVEL-027 | Forgetting contract | A user-facing promise of what is kept, for how long, and how to delete it | `docs/` | S | OWASP |
| NOVEL-028 | Provenance chain viewer | Walk from a sentence to a claim, tool call, and raw source in one click | `public/app.js` | M | RAG |
| NOVEL-029 | Agent biography | A generated history of an agent's notable work, failures, and lessons | `public/app.js` | M | EMERGENT |
| NOVEL-030 | Run storybook | A narrated, chaptered replay of a run for non-technical readers | `lib/chronicle.mjs` | M | Invented |
| NOVEL-031 | Reputation staking | Agents stake reputation on claims and lose it when contradicted | `lib/town.mjs` | M | Invented |
| NOVEL-032 | Tool failure forecast | Predict which tool call is likely to fail from recent error patterns | `lib/tools.mjs` | L | Invented |
| NOVEL-033 | Preflight checklist | Generate a mission-specific checklist of risks and required approvals | `lib/orchestrator.mjs` | S | Invented |
| NOVEL-034 | Mission contract | A signed agreement on scope, budget, deadline, and acceptance criteria | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-035 | Done-ness score | A continuous score of how close the deliverable is to the definition of done | `lib/verifier.mjs` | M | Invented |
| NOVEL-036 | Guardrail synthesis | Turn a new incident into a proposed deterministic guard with tests | `lib/security.mjs` | L | Invented |
| NOVEL-037 | Incident-to-test pipeline | Every confirmed incident must produce a failing test before it is closed | `.github/` | M | AN/evals |
| NOVEL-038 | Provider chaos monkey | Randomly degrade a mock provider in staging to test recovery | `tests/` | M | K8S |
| NOVEL-039 | Latency arbitrage router | Route latency-tolerant steps to cheaper, slower providers automatically | `lib/routing/free-first.mjs` | M | Invented |
| NOVEL-040 | Behavioral diff | Compare agent behavior across model versions on the same missions | `eval/` | L | Invented |
| NOVEL-041 | Context budget planner | A visual plan of what will occupy the context window per phase | `public/app.js` | M | AN/context |
| NOVEL-042 | Context debt | Measure how much essential state lives only in the transcript | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-043 | Compaction quality score | Test whether a summary preserves the facts needed for later steps | `eval/` | M | Invented |
| NOVEL-044 | Summary faithfulness checker | Verify each summary sentence against the source turns | `lib/verifier.mjs` | M | RAG |
| NOVEL-045 | Handoff loss metric | Count facts that disappear between phases | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-046 | Tool ROI | Value delivered per call, token, and dollar for each tool | `lib/metrics.mjs` | L | Invented |
| NOVEL-047 | Agent utilization | Fraction of an agent's context and time spent on accepted work | `lib/metrics.mjs` | S | Invented |
| NOVEL-048 | Debate cost meter | Show the cost of each debate round and the information gained | `public/app.js` | S | Invented |
| NOVEL-049 | Argument map | Render a debate as claims, rebuttals, and evidence links | `public/app.js` | M | Invented |
| NOVEL-050 | Fallacy detector | Flag common reasoning fallacies in agent arguments with examples | `lib/critic.mjs` | M | Invented |
| NOVEL-051 | Steelman requirement | A critic must state the strongest version of the opposing view | `lib/critic.mjs` | S | Invented |
| NOVEL-052 | Pre-mortem generator | Before execution, imagine failure and list the most likely causes | `lib/orchestrator.mjs` | S | Invented |
| NOVEL-053 | Postmortem autogenerator | Draft a blameless postmortem from the run trace and incident timeline | `lib/chronicle.mjs` | M | Invented |
| NOVEL-054 | Lessons-to-lint | Convert repeated lessons into static checks that fail CI | `scripts/` | M | Invented |
| NOVEL-055 | Approval fatigue meter | Track approval volume and false-positive rate to tune thresholds | `lib/metrics.mjs` | M | Invented |
| NOVEL-056 | Consent receipts | A receipt for every use of user data, exportable on request | `lib/store.mjs` | M | OWASP |
| NOVEL-057 | Right-to-explanation export | A plain-language explanation of how a specific output was produced | `bin/cli.mjs` | M | OWASP |
| NOVEL-058 | Agent passport | A portable identity document with skills, limits, versions, and owner | `lib/agents.mjs` | M | A2A |
| NOVEL-059 | Attenuated capability tokens | Delegate a subset of permissions that cannot be widened downstream | `lib/policy.mjs` | L | OWASP |
| NOVEL-060 | Delegation chain viewer | Show who delegated what to whom, with scopes and expiry | `public/app.js` | M | A2A |
| NOVEL-061 | Agent notary | A local attestation service that signs completed work and its inputs | `lib/signature.mjs` | M | C2PA |
| NOVEL-062 | Proof of completion | A verifiable bundle of inputs, actions, checks, and outputs for a run | `lib/signature.mjs` | L | C2PA |
| NOVEL-063 | Run fingerprint | A short hash of config, inputs, and outputs for comparing runs at a glance | `lib/store.mjs` | S | Invented |
| NOVEL-064 | Deterministic mock world | A fixed tool and provider world for demos and tests | `tests/` | M | Invented |
| NOVEL-065 | What-if simulator | Change budget, model, or tools in a copy and preview the diff without running | `public/app.js` | L | Invented |
| NOVEL-066 | Outcome prediction market | Agents post probability estimates for mission success, scored later | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-067 | Calibration training loop | Feed resolved forecasts back as feedback to improve future estimates | `lib/orchestrator.mjs` | M | Invented |
| NOVEL-068 | Brier score dashboard | Track forecast accuracy per agent and per task class | `lib/metrics.mjs` | S | Invented |
| NOVEL-069 | Abstention policy | Agents may abstain with a reason instead of guessing, and abstentions are scored | `lib/orchestrator.mjs` | S | Invented |
| NOVEL-070 | Human attention router | Order the review queue by risk times uncertainty times waiting time | `server.mjs` | M | Invented |
| NOVEL-071 | Audit lottery | Randomly sample a percentage of successful runs for deep review | `server.mjs` | S | Invented |
| NOVEL-072 | Trust-but-verify sampling | Verify a configurable fraction of tool results even when they look valid | `lib/verifier.mjs` | M | Invented |
| NOVEL-073 | Progressive autonomy | A stage-gated rollout from suggest to act-with-approval to act-and-report | `lib/policy.mjs` | M | OPENAI/agents |
| NOVEL-074 | Agent performance review | A periodic, evidence-backed review of an agent's quality and cost | `lib/chronicle.mjs` | M | Invented |
| NOVEL-075 | Agent one-on-one | A retrospective interview that turns recent failures into a personal checklist | `lib/archivist.mjs` | S | Invented |
| NOVEL-076 | Skill tree | Visual progression of capabilities unlocked by demonstrated competence | `public/app.js` | M | VOYAGER |
| NOVEL-077 | Plan tournament | Generate several plans, run cheap probes, and pick the winner by evidence | `lib/orchestrator.mjs` | L | Invented |
| NOVEL-078 | Plan marketplace | Share and import plan templates with ratings and required capabilities | `server.mjs` | L | Invented |
| NOVEL-079 | Recipe library | Parameterized procedures with preconditions, steps, and success checks | `lib/archivist.mjs` | M | AN/skills |
| NOVEL-080 | Risk-adaptive interface | The UI reveals more controls only as the current risk level rises | `public/app.js` | M | Invented |
