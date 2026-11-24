# Evaluation and quality — 90 ideas

The repo already has a golden routing suite and an adversarial injection suite. This
category extends them into trajectory grading, statistical reliability, fault injection,
and release gates that run without any external service.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| EVAL-001 | Eval taxonomy | Define unit, contract, trajectory, outcome, safety, and performance evals | `docs/` | S | AN/evals |
| EVAL-002 | Case registry | One JSON schema for every eval case with id, tags, input, and expectations | `eval/` | S | INSPECT |
| EVAL-003 | Outcome grading | Grade the final deliverable against explicit acceptance checks | `eval/run.mjs` | S | AN/evals |
| EVAL-004 | Trajectory grading | Grade the sequence of phases, steps, and tool calls, not only the answer | `eval/run.mjs` | M | AN/evals |
| EVAL-005 | Step assertions | Assert that a named step ran, in order, with required arguments | `eval/run.mjs` | S | AN/evals |
| EVAL-006 | Tool-call assertions | Assert tool selection, argument validity, and call count bounds | `eval/run.mjs` | S | AN/evals |
| EVAL-007 | Schema assertions | Every structured output must validate against its declared schema | `eval/run.mjs` | S | INSPECT |
| EVAL-008 | Citation assertions | Claims that require evidence must cite an existing source span | `eval/run.mjs` | M | RAG |
| EVAL-009 | Deterministic checks first | Prefer exact and rule-based checks over model judges wherever possible | `eval/run.mjs` | S | AN/evals |
| EVAL-010 | Judge fallback | Use a model judge only for qualities deterministic checks cannot capture | `eval/run.mjs` | M | AN/evals |
| EVAL-011 | Rubric with anchors | Each score level has a concrete example and a required rationale | `eval/` | S | AN/evals |
| EVAL-012 | Judge rationale required | Reject judge output without a criterion-by-criterion rationale | `eval/` | S | AN/evals |
| EVAL-013 | Judge determinism | Temperature zero, fixed seed where supported, and a pinned judge prompt | `eval/` | S | AN/evals |
| EVAL-014 | Position swapping | Run pairwise judges in both orders and average to reduce position bias | `eval/` | M | AN/evals |
| EVAL-015 | Judge calibration set | A small human-labeled set that measures judge agreement before trusting it | `eval/` | M | AN/evals |
| EVAL-016 | Inter-rater agreement | Report Cohen's kappa or simple agreement between judge and human | `eval/` | M | AN/evals |
| EVAL-017 | Adjudication flow | A documented path for resolving judge-human disagreements | `docs/` | S | AN/evals |
| EVAL-018 | Human baseline | Record a human score for a subset so regressions are interpretable | `eval/` | M | AN/evals |
| EVAL-019 | pass@k exploration rate | Probability at least one of k attempts succeeds, for exploration tasks | `eval/run.mjs` | M | AN/evals |
| EVAL-020 | pass^k reliability rate | Probability all k attempts succeed, for reliability-sensitive tasks | `eval/run.mjs` | M | AN/evals |
| EVAL-021 | Variance reporting | Report mean, standard deviation, and worst case across attempts | `eval/run.mjs` | S | AN/evals |
| EVAL-022 | Confidence intervals | Bootstrap intervals around pass rates instead of single numbers | `eval/run.mjs` | M | AN/evals |
| EVAL-023 | Bootstrap resampling | Dependency-free resampling utility for small samples | `eval/` | S | AN/evals |
| EVAL-024 | Sample-size calculator | Recommend case counts for a desired confidence width | `eval/` | S | AN/evals |
| EVAL-025 | Flaky case quarantine | Track inconsistent cases and require a fix or removal within a deadline | `eval/` | M | AN/evals |
| EVAL-026 | Eval retry policy | Retry infrastructure errors but never retry a genuine failure | `eval/run.mjs` | S | AN/evals |
| EVAL-027 | Seeded variance | Record seed per case so failures are reproducible | `eval/run.mjs` | S | AN/evals |
| EVAL-028 | Cost per eval | Report token and currency cost for the whole suite and per case | `eval/run.mjs` | S | OBS |
| EVAL-029 | Latency per eval | Report p50 and p95 duration per case and per phase | `eval/run.mjs` | S | OBS |
| EVAL-030 | Token per eval | Track input, output, and cached tokens per case | `eval/run.mjs` | S | OBS |
| EVAL-031 | Eval budget cap | Stop the suite before exceeding a configured spend | `eval/run.mjs` | S | OBS |
| EVAL-032 | Golden set versioning | Version the case set and record the version used in every report | `eval/golden.json` | S | AN/evals |
| EVAL-033 | Contamination check | Detect cases whose text appears in prompts or training-like fixtures | `eval/` | M | AN/evals |
| EVAL-034 | Held-out set | A private set never used during prompt development | `eval/` | M | AN/evals |
| EVAL-035 | Private regression set | Maintainer-only cases for releases and security fixes | `eval/` | M | OWASP |
| EVAL-036 | Synthetic case generation | Generate candidate cases from a taxonomy and review before adding | `eval/` | L | AN/evals |
| EVAL-037 | Adversarial generation | Mutate known attacks into new phrasings and encodings | `eval/` | M | GARAK |
| EVAL-038 | Case mutation | Vary names, numbers, order, and language while preserving intent | `eval/` | M | AN/evals |
| EVAL-039 | Difficulty tiers | Tag cases as smoke, standard, hard, and adversarial | `eval/` | S | AN/evals |
| EVAL-040 | Coverage matrix | Map cases to capabilities and show uncovered areas | `eval/` | M | AN/evals |
| EVAL-041 | Regression gate | Fail the PR when a tracked metric drops beyond its tolerance | `.github/workflows/` | M | AN/evals |
| EVAL-042 | Canary eval | Run a small fast suite on every push and the full suite nightly | `.github/workflows/` | S | AN/evals |
| EVAL-043 | Nightly full suite | Scheduled run with reports retained and compared to the previous run | `.github/workflows/` | S | AN/evals |
| EVAL-044 | Release eval | A frozen suite that must pass before a version tag | `.github/workflows/` | S | AN/evals |
| EVAL-045 | Model matrix | Run the suite across configured models and publish a comparison table | `eval/` | M | AN/evals |
| EVAL-046 | Provider matrix | Run across providers to catch adapter-specific regressions | `eval/` | M | AN/evals |
| EVAL-047 | Prompt variant matrix | Compare prompt versions on the same cases with confidence intervals | `eval/` | M | LANGFUSE |
| EVAL-048 | Config hash | Hash prompts, models, tools, and seeds into one reproducibility id | `eval/` | S | AN/evals |
| EVAL-049 | Reproducibility manifest | Emit a file listing versions, config, and case set for every run | `eval/` | S | INSPECT |
| EVAL-050 | Artifact retention | Keep raw traces for failed cases and summaries for passes | `eval/` | S | OBS |
| EVAL-051 | Run diffing | Compare two eval runs case by case and show newly broken and fixed | `eval/` | M | LANGFUSE |
| EVAL-052 | Failure clustering | Group failures by error signature to find one root cause | `eval/` | M | OBS |
| EVAL-053 | Failure taxonomy | Codes for planning, tool, retrieval, formatting, safety, and infra failures | `eval/` | S | AN/evals |
| EVAL-054 | Root-cause template | A short structured form attached to every triaged failure | `eval/` | S | OBS |
| EVAL-055 | Triage queue | A file-backed queue of failures with owner and status | `eval/` | M | OBS |
| EVAL-056 | Eval dashboard | Static HTML report with pass rates, trends, cost, and latency | `eval/` | M | LANGFUSE |
| EVAL-057 | Markdown report | Human-readable summary suitable for a PR or release note | `eval/` | S | AN/evals |
| EVAL-058 | PR comment summary | Post a compact metric delta on each pull request | `.github/workflows/` | M | AN/evals |
| EVAL-059 | Status badges | Shields-style badges for suite status and coverage | `docs/` | S | OBS |
| EVAL-060 | Benchmark adapters | Optional adapters for public benchmarks without vendoring their data | `eval/` | L | INSPECT |
| EVAL-061 | MCP conformance | Assert tool listing, structured output, errors, and cancellation behavior | `eval/` | M | MCP |
| EVAL-062 | A2A conformance | Assert Agent Card shape, task lifecycle, and streaming events | `eval/` | M | A2A |
| EVAL-063 | API contract tests | Assert every documented route, status code, and error shape | `tests/` | M | PROBLEM |
| EVAL-064 | Migration tests | Fixture stores at every schema version must migrate and load | `tests/` | M | K8S |
| EVAL-065 | Backwards compatibility | Old clients must keep working across a minor version | `tests/` | M | K8S |
| EVAL-066 | Load test | Sustained concurrent runs with latency and error budgets | `tests/` | L | K8S |
| EVAL-067 | Soak test | Multi-hour run to catch leaks and slow degradation | `tests/` | L | K8S |
| EVAL-068 | Chaos test | Randomly kill steps, delay tools, and corrupt responses in a sandbox | `tests/` | L | K8S |
| EVAL-069 | Provider outage simulation | A mock provider that fails, times out, and rate-limits on command | `tests/` | M | K8S |
| EVAL-070 | Network partition simulation | Abort in-flight sockets and assert clean recovery | `tests/` | M | K8S |
| EVAL-071 | Clock skew simulation | Shift the clock and assert token expiry and timers still behave | `tests/` | S | TEMPORAL |
| EVAL-072 | Disk full simulation | Assert typed errors, no corruption, and a clear operator message | `tests/` | M | K8S |
| EVAL-073 | Corrupted store simulation | Flip bytes and assert quarantine plus partial service | `tests/` | M | K8S |
| EVAL-074 | Input fuzzing | Fuzz every JSON endpoint and parser with generated payloads | `tests/` | M | OWASP |
| EVAL-075 | Property-based tests | Assert invariants such as audit-chain validity after random operations | `tests/` | M | OWASP |
| EVAL-076 | Mutation testing | Mutate source and measure whether tests detect the change | `tests/` | L | INSPECT |
| EVAL-077 | Coverage thresholds | Track line and branch coverage with a ratchet that only moves up | `.github/workflows/` | M | INSPECT |
| EVAL-078 | Accessibility tests | Keyboard-only and screen-reader smoke checks in the DOM harness | `tests/` | M | WCAG |
| EVAL-079 | Performance budgets | Assert page load, bundle size, and first-response thresholds | `tests/` | S | NN/G |
| EVAL-080 | DOM harness | A dependency-free frontend test harness using a minimal fake DOM | `tests/` | L | Invented |
| EVAL-081 | Long-context eval | Cases that require reasoning over a large but bounded evidence set | `eval/` | M | AN/context |
| EVAL-082 | Multi-turn eval | Cases with follow-ups that depend on earlier answers | `eval/` | M | AN/evals |
| EVAL-083 | Clarification quality | Score whether the agent asked the right question at the right time | `eval/` | M | OPENAI/agents |
| EVAL-084 | Refusal quality | Correct refusals must be specific and offer a safe alternative | `eval/` | S | OWASP |
| EVAL-085 | Helpfulness eval | Rubric for usefulness, actionability, and completeness | `eval/` | M | AN/evals |
| EVAL-086 | Hallucination eval | Claims without evidence are flagged and scored | `eval/` | M | RAG |
| EVAL-087 | Groundedness eval | Every cited quote must appear in the cited source | `eval/` | M | RAG |
| EVAL-088 | Format compliance | Output must match the requested structure, length, and tone | `eval/` | S | AN/evals |
| EVAL-089 | Plan quality | Score feasibility, ordering, tool fit, and missing steps | `eval/` | M | AN/agents |
| EVAL-090 | Recovery eval | Inject a mid-run failure and score whether the agent recovers correctly | `eval/` | M | REFLEXION |
