# Sources and how they were used

Research for this catalog came from primary sources on the open web, not only GitHub.
Each idea row ends with a short source key; this file expands those keys. "Invented"
means the idea is original to this catalog and is not a restatement of a published
feature. Where a source describes a pattern rather than a product, the row adapts the
pattern to Agent Village's zero-dependency runtime.

## Labs and engineering playbooks

| Key | Source | What it contributed |
|---|---|---|
| `AN/agents` | [Building effective agents](https://www.anthropic.com/research/building-effective-agents) | Workflow vs. agent distinction, prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, tool prompt design |
| `AN/context` | [Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | Context budget, compaction, structured note-taking, sub-agent isolation, just-in-time retrieval |
| `AN/memory` | [The components of agent memory](https://www.anthropic.com/research/components-of-agent-memory) | Memory hierarchy, "dreaming" consolidation, correcting stale memories, deciding what to remember |
| `AN/managed` | [Scaling managed agents: decoupling the brain from the hands](https://www.anthropic.com/research/managed-agents) | Session state outside the model context, many brains/many hands, durable session logs |
| `AN/harness` | [Harness design for long-running application development](https://www.anthropic.com/research/harness-design-long-running-apps) | Generator/evaluator split, gradable subjective quality, context resets, progress files |
| `AN/tools` | [Advanced tool use](https://www.anthropic.com/research/advanced-tool-use) | Tool search, programmatic tool calling, tool use examples, deferred tool loading |
| `AN/code-mcp` | [Code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp) | Presenting tools as code APIs, filtering large intermediate results inside the sandbox |
| `AN/evals` | [Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | Trajectory vs. outcome grading, pass@k/pass^k, grader calibration, eval roadmap |
| `AN/skills` | [Agent skills](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills) | Packaged procedural knowledge, progressive disclosure |
| `AN/multiagent` | [How we built our multi-agent research system](https://www.anthropic.com/research/multi-agent-research-system) | Orchestrator-worker scaling, token cost of parallelism, delegation prompts |
| `OPENAI/agents` | [A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf) | Guardrails, tool risk tiers, human intervention triggers |
| `GOOGLE/agents` | [Agents whitepaper](https://www.kaggle.com/whitepaper-agents) | Agent taxonomy, tool orchestration, memory, evaluation |
| `DEEPSEEK/r1` | [DeepSeek-R1](https://arxiv.org/abs/2501.12948) | Reasoning traces, distillation, verifiable rewards |

## Protocols and standards

| Key | Source | What it contributed |
|---|---|---|
| `MCP` | [Model Context Protocol, 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18) | Structured tool output, OAuth resource server role, resource indicators, elicitation, resource links |
| `MCP/security` | [MCP security best practices](https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices) | Confused deputy, token passthrough, session hijacking, local server compromise |
| `A2A` | [Agent2Agent Protocol](https://a2a-protocol.org/latest/specification/) | Agent Cards, task lifecycle, streaming, push notifications, artifacts |
| `AGUI` | [AG-UI protocol](https://docs.ag-ui.com/) | Event-based agent-to-UI streaming, shared state, human-in-the-loop |
| `OTEL` | [OpenTelemetry GenAI semantic conventions](https://github.com/open-telemetry/semantic-conventions-genai) | `gen_ai.*` spans, token metrics, agent/tool/MCP conventions |
| `OAUTH/RFC8707` | [RFC 8707 Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707) | Audience-restricted tokens for MCP servers |
| `OAUTH/RFC9728` | [RFC 9728 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728) | Resource-server discovery |
| `PROBLEM` | [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) | Machine-readable API error envelope |
| `C2PA` | [Content Credentials](https://c2pa.org/specifications/specifications/2.1/index.html) | Provenance for generated media |

## Orchestration, durability, and infrastructure

| Key | Source | What it contributed |
|---|---|---|
| `LANGGRAPH` | [LangGraph](https://github.com/langchain-ai/langgraph) | Graph state, checkpointer, interrupt/resume, time travel, human-in-the-loop |
| `TEMPORAL` | [Temporal](https://github.com/temporalio/temporal) | Durable execution, event history replay, activities vs. workflows, heartbeats |
| `INNGEST` | [Inngest](https://github.com/inngest/inngest) | Step functions, idempotency, fan-out, delayed jobs, local dev server |
| `RESTATE` | [Restate](https://github.com/restatedev/restate) | Virtual objects, durable promises, suspend/resume, single-writer semantics |
| `CREWAI` | [CrewAI](https://github.com/crewAIInc/crewAI) | Role/task crews, delegation, process types |
| `AUTOGEN` | [AutoGen](https://github.com/microsoft/autogen) | Conversable agents, group chat, code-executor isolation |
| `OPENWANTS` | [Maplehill / OpenWants](https://github.com/hvaoc/maplehill) | Shared want board, claim/fulfill market, agent discovery without point-to-point wiring |
| `K8S` | [Kubernetes levels of maturity](https://github.com/kubernetes/community/blob/master/contributors/design-proposals/architecture/architecture.md) | Leases, fencing, reconciliation loops, graceful drain |

## Memory and retrieval

| Key | Source | What it contributed |
|---|---|---|
| `LETTA` | [Letta (MemGPT)](https://github.com/letta-ai/letta) | Core/archival memory tiers, self-editing memory, memory pressure |
| `MEM0` | [Mem0](https://github.com/mem0ai/mem0) | Extract/consolidate pipeline, user/session/agent scopes, memory update operations |
| `ZEP` | [Zep / Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge graph, fact validity intervals, bi-temporal queries |
| `COGNEE` | [Cognee](https://github.com/topoteretes/cognee) | Graph + vector memory pipelines, ontology-aware ingestion |
| `GENAGENTS` | [Generative Agents (Smallville)](https://arxiv.org/abs/2304.03442) | Observation/reflection/planning loop, importance scoring, memory stream |
| `REFLEXION` | [Reflexion](https://arxiv.org/abs/2303.11366) | Verbal self-reflection stored for later attempts |
| `VOYAGER` | [Voyager](https://arxiv.org/abs/2305.16291) | Skill library of reusable code, automatic curriculum |
| `RAG` | [Retrieval-Augmented Generation](https://arxiv.org/abs/2005.11401) | Grounding, retrieval budgets, citation |
| `HYDE` | [HyDE](https://arxiv.org/abs/2212.10496) | Hypothetical-document query expansion |
| `RAPTOR` | [RAPTOR](https://arxiv.org/abs/2401.18059) | Hierarchical summary trees for retrieval |

## Security, safety, and evaluation

| Key | Source | What it contributed |
|---|---|---|
| `OWASP` | [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) | Prompt injection, insecure output handling, excessive agency, supply chain |
| `NEMO` | [NeMo Guardrails](https://github.com/NVIDIA/NeMo-Guardrails) | Input/output/dialog rails, programmable policies |
| `GARAK` | [garak](https://github.com/NVIDIA/garak) | LLM vulnerability probes and probe corpora |
| `INJ` | [Prompt injection literature](https://arxiv.org/abs/2302.12173) | Direct/indirect injection, instruction hierarchy, spotlighting |
| `CAIS` | [Center for AI Safety evaluations](https://www.safetyresearch.org/) | Safety eval design, red teaming |
| `EVALBOOK` | [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) | Solver/scorer separation, logged samples, reproducible eval runs |
| `INSPECT` | [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai) | Same project as `EVALBOOK`; used for eval harness and logged-sample ideas |
| `OBS` | [Google SRE Book](https://sre.google/sre-book/table-of-contents/) | SLOs, error budgets, symptom-based alerting, capacity and load management |
| `LANGFUSE` | [Langfuse](https://github.com/langfuse/langfuse) | Trace trees, prompt management, datasets, experiments, scores |
| `PHOENIX` | [Arize Phoenix](https://github.com/Arize-ai/phoenix) | OpenInference spans, eval-driven development |

## Simulation and product UX

| Key | Source | What it contributed |
|---|---|---|
| `EMERGENT` | [Emergent City](https://github.com/harishkotra/emergent-city) | Player-as-god events, emergent agent society, shareable world state |
| `CANVA` | [Canva AI](https://www.canva.com/canva-ai/) | Start-from-idea, conversational refinement, user control, connected context |
| `FIGMA` | [Figma AI](https://www.figma.com/) | Shared AI-native canvas, context carried design-to-ship |
| `NN/G` | [NN/g AI UX guidance](https://www.nngroup.com/) | Visibility of system status, undo, progressive disclosure, error recovery |
| `WCAG` | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Keyboard, focus, contrast, motion, target size requirements |
| `AGENTUX` | [Fuselab, UI design for AI agents](https://fuselabcreative.com/ui-design-for-ai-agents/) | Plan visibility, separate activity stream, pause/override points, confidence signaling |

## Community signal

| Key | Source | What it contributed |
|---|---|---|
| `HN` | [Hacker News Algolia API](https://hn.algolia.com/api) | Practitioner complaints: cost blowups, flaky agents, opaque failures, eval theater |
| `GH/TREND` | [GitHub search API](https://docs.github.com/en/rest/search) | Feature landscape across 2k+ star agent frameworks |
| `LOCALFIRST` | [Local-first software](https://www.inkandswitch.com/local-first/) | Offline tolerance, sync, conflict handling for long-running sessions |

## Notes on selection

- Ideas must fit the existing contract: no shell execution, no arbitrary file writes,
  no browser-side secrets, no unattended consequential actions.
- Optional adapters (SQLite, Postgres, Redis, S3) are marked as such and must remain
  behind an interface so the default install stays zero-dependency.
- Effort is relative to this repository: **S** under a day, **M** one to three days,
  **L** more than three days for one experienced contributor.
