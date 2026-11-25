# Models, prompts, and context — 90 ideas

Provider plumbing and prompt craft. The existing layer already has four providers,
streaming, fallback chains, circuit breakers, and JSON repair; these rows deepen
quality control, cost control, and portability.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| LLM-001 | Provider registry as data | Move provider definitions into a declarative table with capability flags | `lib/llm.mjs` | S | Invented |
| LLM-002 | Model capability matrix | Record context window, tool support, vision, JSON mode, and streaming per model | `lib/llm.mjs` | S | AN/evals |
| LLM-003 | Cost table | Per-million input/output prices with an effective date and source | `lib/llm.mjs` | S | Invented |
| LLM-004 | Token estimator | Conservative token counting per provider with a calibration factor | `lib/llm.mjs` | M | Invented |
| LLM-005 | Context window registry | Hard limits per model, including output reservation | `lib/llm.mjs` | S | Invented |
| LLM-006 | Context overflow guard | Estimate before sending and compact or reject with a clear error | `lib/llm.mjs` | M | AN/context |
| LLM-007 | Prompt cache hints | Mark stable prefixes for providers that support explicit cache breakpoints | `lib/llm.mjs` | M | AN/context |
| LLM-008 | Cache-aware ordering | Put stable instructions and tools first, volatile evidence last | `lib/llm.mjs` | S | AN/context |
| LLM-009 | System prompt versioning | Immutable prompt ids with a changelog and rollback | `lib/agents.mjs` | M | LANGFUSE |
| LLM-010 | Prompt template engine | Minimal `{{var}}` substitution with escaping and required-variable checks | `lib/llm.mjs` | S | Invented |
| LLM-011 | Typed prompt variables | Declare variable types and validate before rendering | `lib/llm.mjs` | S | Invented |
| LLM-012 | Few-shot library | Curated examples per task with token cost and freshness metadata | `lib/agents.mjs` | M | AN/tools |
| LLM-013 | Prompt linting | Flag vague verbs, missing output format, contradictions, and unbounded scope | `lib/agents.mjs` | M | Invented |
| LLM-014 | Prompt diff simulator | Show how an instruction edit changes outputs on the golden set before shipping | `eval/` | L | AN/evals |
| LLM-015 | Instruction hierarchy | Explicit precedence for system, developer, user, and retrieved content | `lib/agents.mjs` | S | INJ |
| LLM-016 | Spotlighting | Wrap untrusted text in delimiters plus a provenance label the model must respect | `lib/security.mjs` | S | INJ |
| LLM-017 | Delimiter discipline | One canonical delimiter format with escaping for embedded delimiters | `lib/security.mjs` | S | INJ |
| LLM-018 | Output schema enforcement | Attach a JSON Schema to every structured role and reject non-conforming output | `lib/json.mjs` | M | OPENAI/agents |
| LLM-019 | Zero-dependency schema validator | Support the JSON Schema subset the project actually uses | `lib/json.mjs` | M | Invented |
| LLM-020 | Schema repair loop | Feed validation errors back once, then fail with a typed error | `lib/json.mjs` | S | AN/agents |
| LLM-021 | Refusal detection | Detect safety refusals and route them to a policy path instead of retrying blindly | `lib/llm.mjs` | S | OPENAI/agents |
| LLM-022 | Truncation detection | Treat `length` finish reasons as failures for structured roles | `lib/llm.mjs` | S | Invented |
| LLM-023 | Finish-reason handling | Map every provider finish reason into a small normalized enum | `lib/llm.mjs` | S | Invented |
| LLM-024 | Stop sequences per provider | Normalize stop handling and reject unsupported combinations | `lib/llm.mjs` | S | Invented |
| LLM-025 | Seed support | Pass seeds where available and record when they are ignored | `lib/llm.mjs` | S | AN/evals |
| LLM-026 | Per-role temperature policy | Planner low, Reviewer moderate, Critic higher, with documented reasons | `lib/agents.mjs` | S | AN/agents |
| LLM-027 | Top-p policy | Expose top-p only where it changes behavior, avoid tuning both knobs blindly | `lib/llm.mjs` | S | Invented |
| LLM-028 | Per-role max tokens | Budget output length per role and validate against the schema size | `lib/agents.mjs` | S | Invented |
| LLM-029 | Model cascade | Try a small model, escalate only on low confidence or verification failure | `lib/llm.mjs` | M | AN/agents |
| LLM-030 | Best-of-n sampling | Sample n candidates for high-stakes steps and select with a verifier | `lib/orchestrator.mjs` | M | AN/evals |
| LLM-031 | Self-consistency | Majority vote over sampled reasoning paths for classification tasks | `lib/orchestrator.mjs` | M | AN/evals |
| LLM-032 | Verifier reranking | Use deterministic checks or a judge to pick among candidate outputs | `lib/verifier.mjs` | M | AN/evals |
| LLM-033 | Rubric judge | A judge prompt with explicit criteria, anchors, and a required rationale | `lib/critic.mjs` | S | AN/evals |
| LLM-034 | Pairwise judge | Compare two outputs with position swapping to reduce bias | `eval/` | M | AN/evals |
| LLM-035 | Judge calibration | Measure judge agreement against a small human-labeled set | `eval/` | M | AN/evals |
| LLM-036 | Model fingerprint | Record provider response headers and model ids to detect silent changes | `lib/llm.mjs` | S | Invented |
| LLM-037 | Alias drift detection | Warn when a moving alias resolves to a different snapshot than the pinned one | `lib/llm.mjs` | S | AN/evals |
| LLM-038 | Deprecation tracker | Keep a table of retirement dates and fail CI when a pinned model is near EOL | `lib/llm.mjs` | S | OBS |
| LLM-039 | Health probes | Cheap periodic probes per provider with latency and error classification | `lib/llm.mjs` | S | OBS |
| LLM-040 | Half-open probes | Allow a single trial request through an open breaker with a strict timeout | `lib/llm.mjs` | S | K8S |
| LLM-041 | Retry-After respect | Honor provider backoff headers instead of fixed sleeps | `lib/llm.mjs` | S | INNGEST |
| LLM-042 | Full jitter | Randomized exponential backoff with a cap to avoid synchronized retries | `lib/llm.mjs` | S | INNGEST |
| LLM-043 | Per-request timeout | Abort a single model call without cancelling the whole run | `lib/llm.mjs` | S | TEMPORAL |
| LLM-044 | Abort propagation | Thread the run abort signal into fetch so cancellation is immediate | `lib/llm.mjs` | S | TEMPORAL |
| LLM-045 | Streaming JSON parser | Parse structured output incrementally so the UI can render partial fields | `lib/json.mjs` | M | Invented |
| LLM-046 | Partial JSON rendering | Show a live plan as it streams instead of waiting for the closing brace | `public/app.js` | M | AGUI |
| LLM-047 | SSE keepalive | Emit comment pings during long silences to survive proxies | `server.mjs` | S | AGUI |
| LLM-048 | Stream backpressure | Pause reads when the client is slow and buffer with a hard cap | `server.mjs` | M | Invented |
| LLM-049 | Concurrency limiter | Cap simultaneous model calls per provider and queue the rest | `lib/llm.mjs` | M | K8S |
| LLM-050 | Token-bucket rate limiter | Smooth request rate per provider and per user | `lib/llm.mjs` | M | K8S |
| LLM-051 | Per-user quotas | Daily token and request quotas with a clear reset time | `server.mjs` | M | OWASP |
| LLM-052 | Run budget enforcement | Stop before a call that would exceed the run budget, and checkpoint | `lib/budget.mjs` | S | AN/context |
| LLM-053 | Spend alerts | Notify at 50, 80, and 100 percent of a configured budget | `lib/budget.mjs` | S | OBS |
| LLM-054 | Cost attribution | Attribute cost per phase, role, and tool to explain expensive runs | `lib/metrics.mjs` | S | OBS |
| LLM-055 | Usage normalization | Normalize input, output, cached, and reasoning tokens across providers | `lib/llm.mjs` | S | OTEL |
| LLM-056 | llama.cpp support | Add an OpenAI-compatible local adapter preset with health checks | `lib/llm.mjs` | S | Invented |
| LLM-057 | LM Studio preset | Documented local preset with model discovery | `lib/llm.mjs` | S | Invented |
| LLM-058 | Gemini adapter | Native streaming and tool-calling adapter | `lib/llm.mjs` | M | GOOGLE/agents |
| LLM-059 | Mistral adapter | Native adapter with JSON mode and function calling | `lib/llm.mjs` | M | Invented |
| LLM-060 | Groq adapter | Low-latency adapter with strict rate-limit handling | `lib/llm.mjs` | M | Invented |
| LLM-061 | OpenRouter preset | One key, many models, with per-model capability lookup | `lib/llm.mjs` | S | Invented |
| LLM-062 | Bedrock adapter | SigV4 signing with a minimal dependency-free implementation | `lib/llm.mjs` | L | Invented |
| LLM-063 | Azure OpenAI preset | Deployment-based URLs and api-version handling | `lib/llm.mjs` | S | Invented |
| LLM-064 | Vertex preset | Project and region configuration with OAuth token input | `lib/llm.mjs` | L | Invented |
| LLM-065 | DeepSeek preset | OpenAI-compatible reasoning model with reasoning-token accounting | `lib/llm.mjs` | S | DEEPSEEK/r1 |
| LLM-066 | Vision input | Accept an image URL or data URI and route only to vision-capable models | `lib/llm.mjs` | M | Invented |
| LLM-067 | Image preprocessing | Downscale and strip metadata before sending images to providers | `lib/llm.mjs` | M | OWASP |
| LLM-068 | OCR tool | Extract text from images locally or via an approved provider | `lib/tools.mjs` | M | Invented |
| LLM-069 | Speech-to-text | Optional transcription adapter with size and duration limits | `lib/llm.mjs` | M | Invented |
| LLM-070 | Text-to-speech | Optional narration of run summaries with a local voice adapter | `lib/llm.mjs` | M | Invented |
| LLM-071 | Translation step | Detect language and translate the final deliverable with a glossary | `lib/synthesizer.mjs` | M | Invented |
| LLM-072 | Embedding provider interface | Allow a real embedding provider without breaking the hashed default | `lib/memory.mjs` | M | RAG |
| LLM-073 | Reranker provider | Optional cross-encoder reranking behind an interface | `lib/memory.mjs` | M | RAG |
| LLM-074 | Tool-call normalization | Convert provider-specific tool calls into one internal shape | `lib/llm.mjs` | M | MCP |
| LLM-075 | Parallel tool calls | Permit multiple tool calls per turn when the provider supports it | `lib/orchestrator.mjs` | M | AN/tools |
| LLM-076 | Forced tool choice | Support required, auto, and none with a portable mapping | `lib/llm.mjs` | S | AN/tools |
| LLM-077 | Tool search integration | Let the model request tools by description instead of receiving all schemas | `lib/tools.mjs` | M | AN/tools |
| LLM-078 | Tool schema caching | Cache rendered tool schemas per provider so stable prefixes can be reused | `lib/llm.mjs` | S | AN/tools |
| LLM-079 | Programmatic tool calling | Let the model write a short composition that runs in a restricted interpreter | `lib/tools.mjs` | L | AN/tools |
| LLM-080 | Sandboxed code interpreter | A worker-isolated evaluator with no network, no filesystem, and a time cap | `lib/tools.mjs` | L | AN/code-mcp |
| LLM-081 | Response caching | Cache deterministic requests with an explicit opt-in per role | `lib/llm.mjs` | S | Invented |
| LLM-082 | Record and replay | Store request/response cassettes so tests run without network or keys | `tests/` | M | INSPECT |
| LLM-083 | Mock fixtures | Named fixtures for each role with schema-valid outputs | `tests/` | S | INSPECT |
| LLM-084 | Deterministic test mode | Force mock provider, fixed seed, and frozen clock in tests | `tests/` | S | AN/evals |
| LLM-085 | Prompt retention policy | Configurable prompt/response retention with a default of metadata only | `lib/store.mjs` | M | OWASP |
| LLM-086 | Zero-retention headers | Send provider headers that disable training or retention where offered | `lib/llm.mjs` | S | OWASP |
| LLM-087 | PII redaction before send | Detect and mask emails, phones, and ids before leaving the process | `lib/security.mjs` | M | OWASP |
| LLM-088 | Secret preflight | Scan prompts for credentials and block the request with a precise location | `lib/security.mjs` | S | OWASP |
| LLM-089 | Data residency routing | Restrict providers by region and refuse routes that violate the policy | `lib/llm.mjs` | M | OWASP |
| LLM-090 | Model card registry | Human-readable cards with known limits, safety behavior, and eval results | `docs/` | S | OWASP |
