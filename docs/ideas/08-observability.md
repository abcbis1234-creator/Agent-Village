# Observability and operations — 80 ideas

Runs must be explainable after the fact. The repo already emits request ids, structured
logs, metrics, provider health, and an audit chain; these rows connect them into traces,
SLOs, and an operator-facing timeline.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| OBS-001 | One trace per run | Create a root span for the run and propagate trace context to every phase | `lib/metrics.mjs` | M | OTEL |
| OBS-002 | Phase spans | A child span per phase with start, end, status, and key attributes | `lib/orchestrator.mjs` | S | OTEL |
| OBS-003 | LLM call spans | One span per model request with model, provider, tokens, and finish reason | `lib/llm.mjs` | S | OTEL |
| OBS-004 | Tool call spans | One span per tool invocation with sanitized arguments and result size | `lib/tools.mjs` | S | OTEL |
| OBS-005 | GenAI attributes | Adopt `gen_ai.*` names for system, operation, request model, and usage | `lib/metrics.mjs` | M | OTEL |
| OBS-006 | Agent attributes | Record agent id, role, attempt, and parent agent on spans | `lib/orchestrator.mjs` | S | OTEL |
| OBS-007 | MCP attributes | Record server name, tool name, and protocol version for MCP calls | `lib/mcp.mjs` | S | OTEL |
| OBS-008 | Trace propagation | Accept W3C `traceparent` and continue an upstream trace | `server.mjs` | S | OTEL |
| OBS-009 | Baggage limits | Allow a small allowlisted baggage set and drop the rest | `server.mjs` | S | OTEL |
| OBS-010 | Retry span links | Link retry spans to the original attempt instead of nesting them | `lib/llm.mjs` | S | OTEL |
| OBS-011 | Checkpoint events | Emit a span event for every checkpoint with size and duration | `lib/store.mjs` | S | OTEL |
| OBS-012 | Run counters | Count started, completed, failed, suspended, and cancelled runs | `lib/metrics.mjs` | S | OBS |
| OBS-013 | Run duration histogram | Bucketed duration by capability and outcome | `lib/metrics.mjs` | S | OBS |
| OBS-014 | Phase duration histogram | Identify which phase dominates latency | `lib/metrics.mjs` | S | OBS |
| OBS-015 | Model latency histogram | Per provider and model, separate from total run time | `lib/metrics.mjs` | S | OBS |
| OBS-016 | Time to first token | Track streaming responsiveness separately from completion time | `lib/llm.mjs` | S | OBS |
| OBS-017 | Token counters | Input, output, cached, and reasoning tokens per role and provider | `lib/metrics.mjs` | S | OTEL |
| OBS-018 | Cost counters | Estimated cost per request, run, user, and day | `lib/metrics.mjs` | S | OBS |
| OBS-019 | Cache hit rate | Track semantic and exact cache hits, misses, and savings | `lib/llm.mjs` | S | OBS |
| OBS-020 | Tool latency histogram | Per tool p50 and p95 to spot slow connectors | `lib/metrics.mjs` | S | OBS |
| OBS-021 | Tool error rate | Errors by tool and error code | `lib/metrics.mjs` | S | OBS |
| OBS-022 | Provider error rate | Errors by provider, status, and retryable class | `lib/metrics.mjs` | S | OBS |
| OBS-023 | Breaker state gauge | Current closed, half-open, or open state per provider | `lib/metrics.mjs` | S | OBS |
| OBS-024 | Queue depth | Pending runs and pending steps with age of the oldest item | `server.mjs` | S | K8S |
| OBS-025 | Active run gauge | Runs currently executing, suspended, and waiting for approval | `server.mjs` | S | K8S |
| OBS-026 | Checkpoint size gauge | Detect runaway state growth before it fills the disk | `lib/store.mjs` | S | K8S |
| OBS-027 | Store size gauge | Snapshot, journal, checkpoints, artifacts, and backups separately | `lib/store.mjs` | S | K8S |
| OBS-028 | Event loop lag | Sample delay and expose p95 to catch blocking work | `server.mjs` | S | OBS |
| OBS-029 | Resident memory | RSS and heap used with a soft warning threshold | `server.mjs` | S | OBS |
| OBS-030 | CPU time | Process CPU seconds per interval | `server.mjs` | S | OBS |
| OBS-031 | Open handle count | Leak detection for sockets, timers, and file descriptors | `server.mjs` | S | OBS |
| OBS-032 | GC pause metrics | Use `perf_hooks` to report pause duration where available | `server.mjs` | S | OBS |
| OBS-033 | Request rate | Requests per route and method | `lib/metrics.mjs` | S | OBS |
| OBS-034 | Error rate by status | 4xx and 5xx counts with the top error codes | `lib/metrics.mjs` | S | OBS |
| OBS-035 | SSE connection gauge | Open streams and their age | `server.mjs` | S | OBS |
| OBS-036 | SSE disconnect rate | Clients that leave early, which often signals a UI bug | `server.mjs` | S | OBS |
| OBS-037 | Dynamic log level | Change log level at runtime through an authenticated admin route | `server.mjs` | S | OBS |
| OBS-038 | Structured log schema | One JSON schema for logs with level, event, run, phase, and error code | `lib/metrics.mjs` | S | OBS |
| OBS-039 | Request id everywhere | Include the request id in every log line and error response | `server.mjs` | S | OBS |
| OBS-040 | Correlation id | A client-supplied id that survives retries and async continuations | `server.mjs` | S | OBS |
| OBS-041 | Trace id in logs | Print the active trace id so logs and traces join cleanly | `lib/metrics.mjs` | S | OTEL |
| OBS-042 | Redaction in logs | Apply the same redaction rules as the audit chain | `lib/security.mjs` | S | OWASP |
| OBS-043 | Head sampling | Sample a configurable fraction of successful traces | `lib/metrics.mjs` | S | OTEL |
| OBS-044 | Tail sampling | Always keep failed and slow traces, sample the rest | `lib/metrics.mjs` | M | OTEL |
| OBS-045 | Cardinality guard | Cap label values and drop unbounded ids from metrics | `lib/metrics.mjs` | S | OTEL |
| OBS-046 | Prometheus endpoint | A text-format `/metrics` route with a stable metric registry | `server.mjs` | M | OBS |
| OBS-047 | OTLP export | Optional OTLP/HTTP export of spans and metrics | `lib/metrics.mjs` | L | OTEL |
| OBS-048 | Liveness endpoint | `/healthz` that only checks the process is responsive | `server.mjs` | S | K8S |
| OBS-049 | Readiness endpoint | `/readyz` that checks store writability and required config | `server.mjs` | S | K8S |
| OBS-050 | Version endpoint | Expose version, commit, and build time without secrets | `server.mjs` | S | K8S |
| OBS-051 | Build info metric | A constant metric with version and commit labels | `lib/metrics.mjs` | S | OBS |
| OBS-052 | Startup config diff | Log non-secret config changes relative to defaults | `server.mjs` | S | OBS |
| OBS-053 | Feature flag state | Export current flags so behavior differences are explainable | `server.mjs` | S | OBS |
| OBS-054 | Deploy markers | Annotate dashboards with deploy times | `docs/` | S | OBS |
| OBS-055 | Alert rules | Example rules for error rate, latency, queue age, and disk use | `docs/` | S | OBS |
| OBS-056 | SLO document | Define availability and latency SLOs with measurement windows | `docs/` | S | OBS |
| OBS-057 | Error budget | Compute remaining budget from the SLO and current burn | `lib/metrics.mjs` | M | OBS |
| OBS-058 | Burn-rate alert | Page on fast burn and ticket on slow burn | `docs/` | S | OBS |
| OBS-059 | Status page | A static page generated from health checks and incidents | `public/` | M | OBS |
| OBS-060 | Run timeline | A vertical timeline of phases, tools, checkpoints, and approvals | `public/app.js` | M | AGUI |
| OBS-061 | Waterfall view | Horizontal bars showing phase and step durations | `public/app.js` | M | OBS |
| OBS-062 | Flame view | Nested phase tree sized by duration | `public/app.js` | L | OBS |
| OBS-063 | Token waterfall | Where tokens were spent across phases and prompts | `public/app.js` | M | OBS |
| OBS-064 | Cost breakdown | Cost by phase, role, and tool with a total | `public/app.js` | S | OBS |
| OBS-065 | Event stream filter | Filter by phase, role, severity, and event type | `public/app.js` | S | OBS |
| OBS-066 | Saved views | Save a filter and time range as a named view | `public/app.js` | M | OBS |
| OBS-067 | Shareable run link | A read-only permalink with secrets and private fields removed | `server.mjs` | M | OBS |
| OBS-068 | Incident timeline | Merge alerts, deploys, and run failures into one timeline | `public/app.js` | L | OBS |
| OBS-069 | Postmortem export | Export the incident timeline plus notes as markdown | `bin/cli.mjs` | M | OBS |
| OBS-070 | Audit viewer | Browse the hash chain with verification status per record | `public/app.js` | M | OWASP |
| OBS-071 | Decision log viewer | Show each decision, alternatives, and the evidence used | `public/app.js` | M | Invented |
| OBS-072 | Opt-in payload capture | Store prompts and responses only when a per-run flag is set | `lib/store.mjs` | M | OWASP |
| OBS-073 | Prompt version diff | Compare rendered prompts between versions and runs | `public/app.js` | M | LANGFUSE |
| OBS-074 | Trace search | Search runs by mission, error code, provider, model, and duration | `server.mjs` | M | LANGFUSE |
| OBS-075 | Trace retention | Configurable retention with sampling and archive | `lib/store.mjs` | M | OBS |
| OBS-076 | Metrics retention | Downsample old metrics into hourly and daily rollups | `lib/metrics.mjs` | M | OBS |
| OBS-077 | Dashboards as code | JSON dashboard definitions checked into the repo | `docs/` | M | OBS |
| OBS-078 | Synthetic probe | A scheduled canary mission that exercises the full path | `server.mjs` | M | K8S |
| OBS-079 | Dependency health panel | Provider, store, and connector status in one operator view | `public/app.js` | M | OBS |
| OBS-080 | Capacity dashboard | Runs per hour, tokens per run, and headroom against limits | `public/app.js` | M | K8S |
