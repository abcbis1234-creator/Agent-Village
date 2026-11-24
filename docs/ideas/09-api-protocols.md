# API, protocols, and interoperability — 80 ideas

Agent Village already exposes a bounded HTTP contract and an SSE stream. These rows
make it a stable platform: versioned routes, machine-readable errors, resumable streams,
webhooks, and compatibility with A2A, AG-UI, and MCP.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| API-001 | Versioned API prefix | Mount the contract under `/api/v1` and keep a compatibility alias | `server.mjs` | S | K8S |
| API-002 | OpenAPI document | A checked-in OpenAPI 3.1 description of every route and schema | `docs/openapi.json` | M | PROBLEM |
| API-003 | Zero-dependency API explorer | A static HTML page that renders the OpenAPI document | `public/api.html` | M | Invented |
| API-004 | Schema examples | Every request and response field has a realistic example | `docs/openapi.json` | S | PROBLEM |
| API-005 | Problem Details errors | Use RFC 9457 `application/problem+json` for every error | `server.mjs` | S | PROBLEM |
| API-006 | Stable error codes | Add a machine-readable `code` beside the human message | `server.mjs` | S | PROBLEM |
| API-007 | Cursor pagination | Opaque cursors for runs, events, memories, and wants | `server.mjs` | M | PROBLEM |
| API-008 | Filtering | Filter lists by status, capability, user, tag, and date range | `server.mjs` | M | PROBLEM |
| API-009 | Sorting | Allowlisted sort fields with stable tie-breakers | `server.mjs` | S | PROBLEM |
| API-010 | Sparse fields | `fields=` to reduce payloads for list views | `server.mjs` | S | PROBLEM |
| API-011 | Idempotency keys | Honor `Idempotency-Key` on every POST and replay the first result | `server.mjs` | M | INNGEST |
| API-012 | ETags | Return a strong ETag for run and memory resources | `server.mjs` | S | PROBLEM |
| API-013 | Conditional GET | Support `If-None-Match` and return 304 when unchanged | `server.mjs` | S | PROBLEM |
| API-014 | Cache-Control policy | Explicit no-store for sensitive data and short TTLs for static assets | `server.mjs` | S | OWASP |
| API-015 | Rate-limit headers | Standard limit, remaining, and reset headers on every response | `server.mjs` | S | PROBLEM |
| API-016 | Retry-After | Send it on 429 and 503 with a jittered suggestion | `server.mjs` | S | PROBLEM |
| API-017 | Deprecation headers | `Deprecation` and `Link` headers on routes scheduled for removal | `server.mjs` | S | PROBLEM |
| API-018 | Sunset headers | Publish the removal date and migration link | `server.mjs` | S | PROBLEM |
| API-019 | Content negotiation | Accept JSON and, where useful, `text/event-stream` and `text/markdown` | `server.mjs` | S | PROBLEM |
| API-020 | Response compression | gzip or brotli for JSON above a threshold | `server.mjs` | S | PROBLEM |
| API-021 | Request size limits | Route-specific byte caps with a typed 413 response | `server.mjs` | S | OWASP |
| API-022 | Multipart upload | Bounded file upload for images and documents with type checks | `server.mjs` | M | OWASP |
| API-023 | Streaming upload | Accept a stream with a hard byte cap and abort on overflow | `server.mjs` | M | OWASP |
| API-024 | Resumable SSE | Honor `Last-Event-ID` and replay missed events from the journal | `server.mjs` | M | AGUI |
| API-025 | Monotonic event ids | Every SSE event gets a stable, ordered id | `server.mjs` | S | AGUI |
| API-026 | SSE heartbeat | Comment pings every 15 seconds during idle periods | `server.mjs` | S | AGUI |
| API-027 | WebSocket channel | Optional bidirectional channel for steering and approvals | `server.mjs` | L | AGUI |
| API-028 | Webhook subscriptions | Register a URL, event types, and a secret per subscription | `server.mjs` | M | INNGEST |
| API-029 | Webhook key rotation | Accept two active secrets with a key id header so rotation needs no downtime | `server.mjs` | S | OWASP |
| API-030 | Webhook retries | Exponential backoff with a maximum age and a dead-letter state | `lib/store.mjs` | M | INNGEST |
| API-031 | Webhook delivery log | Per-attempt status, latency, and response snippet | `lib/store.mjs` | S | INNGEST |
| API-032 | Webhook replay | Re-deliver a specific event to a subscription on demand | `server.mjs` | S | INNGEST |
| API-033 | Async job pattern | Return 202 plus a Location header for long operations | `server.mjs` | S | PROBLEM |
| API-034 | Job status route | Poll status, progress, and a short message | `server.mjs` | S | PROBLEM |
| API-035 | Job cancellation | Cancel a queued or running job with a reason | `server.mjs` | S | TEMPORAL |
| API-036 | Job result route | Fetch the final result or a typed not-ready response | `server.mjs` | S | PROBLEM |
| API-037 | Batch endpoint | Submit up to N independent missions with per-item results | `server.mjs` | M | PROBLEM |
| API-038 | Bulk create | Create many wants, memories, or webhooks atomically | `server.mjs` | M | PROBLEM |
| API-039 | Long polling | Optional wait-for-change query for clients without SSE | `server.mjs` | M | PROBLEM |
| API-040 | Health and readiness | Separate liveness and dependency readiness routes | `server.mjs` | S | K8S |
| API-041 | Metrics route | Prometheus text format behind an operator token | `server.mjs` | M | OBS |
| API-042 | Version route | Version, commit, and build time with no secrets | `server.mjs` | S | K8S |
| API-043 | Capabilities route | Machine-readable capabilities and limits, already present, extended with versions | `server.mjs` | S | MCP |
| API-044 | Agent contract route | Publish the bounded contract, schemas, and approval requirements | `server.mjs` | S | A2A |
| API-045 | A2A Agent Card | Describe skills, endpoints, auth, and capabilities at the well-known path | `server.mjs` | M | A2A |
| API-046 | A2A task creation | Accept a task, return a task id, and stream status | `server.mjs` | L | A2A |
| API-047 | A2A task lookup | Return state, artifacts, and history for a task id | `server.mjs` | M | A2A |
| API-048 | A2A cancellation | Cancel a task and report the terminal state | `server.mjs` | S | A2A |
| API-049 | A2A streaming | Emit status and artifact updates over SSE | `server.mjs` | M | A2A |
| API-050 | A2A push config | Register a push endpoint for long-running tasks | `server.mjs` | M | A2A |
| API-051 | A2A artifacts | Return deliverables as typed artifacts with media types | `server.mjs` | M | A2A |
| API-052 | AG-UI event stream | Map run events to the AG-UI event vocabulary | `server.mjs` | M | AGUI |
| API-053 | AG-UI shared state | Publish a typed snapshot plus deltas for the UI | `server.mjs` | M | AGUI |
| API-054 | AG-UI interrupts | Represent approvals and clarifications as first-class interrupts | `server.mjs` | M | AGUI |
| API-055 | OpenAI-compatible shim | `/v1/chat/completions` mapped onto the orchestrator for tooling compatibility | `server.mjs` | L | Invented |
| API-056 | Anthropic-compatible shim | `/v1/messages` with streaming for client compatibility | `server.mjs` | L | Invented |
| API-057 | MCP HTTP endpoint | Streamable HTTP transport for the MCP server mode | `server.mjs` | L | MCP |
| API-058 | MCP stdio bridge | A CLI bridge for local MCP clients | `bin/cli.mjs` | M | MCP |
| API-059 | Device authorization flow | OAuth device flow for CLI login without copying keys | `server.mjs` | L | OWASP |
| API-060 | API key management | Create, list, rotate, and revoke keys with prefixes and scopes | `server.mjs` | M | OWASP |
| API-061 | Browser sessions | Cookie sessions with rotation and a short idle timeout | `server.mjs` | M | OWASP |
| API-062 | Scope enforcement | Every route declares required scopes and rejects missing ones | `server.mjs` | M | OWASP |
| API-063 | Tenant header | Explicit tenant selection validated against membership | `server.mjs` | M | OWASP |
| API-064 | Quota headers | Current usage and remaining quota per period | `server.mjs` | S | OBS |
| API-065 | JSONL export | Stream runs, events, or memories as newline-delimited JSON | `server.mjs` | S | OBS |
| API-066 | CSV export | Export tabular lists with formula-injection protection | `server.mjs` | S | OWASP |
| API-067 | Import endpoint | Validate and import an export bundle with a dry-run report | `server.mjs` | M | K8S |
| API-068 | Backup endpoint | Create a consistent backup without stopping the server | `server.mjs` | L | K8S |
| API-069 | Restore endpoint | Restore from a backup into an empty instance with verification | `server.mjs` | L | K8S |
| API-070 | Audit query route | Paginated, filtered access to the audit chain for operators | `server.mjs` | M | OWASP |
| API-071 | Plugin interface | A documented, in-process extension point for routes and tools | `lib/plugins.mjs` | L | Invented |
| API-072 | Middleware chain | Composable request middleware with a fixed order and timeouts | `server.mjs` | M | Invented |
| API-073 | Route registry | One table of routes with method, schema, scopes, and handler | `server.mjs` | M | Invented |
| API-074 | Request context | Carry request id, user, tenant, and abort signal through one object | `server.mjs` | S | Invented |
| API-075 | Config schema | Validate environment configuration against a typed schema | `server.mjs` | M | K8S |
| API-076 | Generated client | Generate a typed fetch client from the OpenAPI document | `bin/cli.mjs` | L | PROBLEM |
| API-077 | CLI parity | Every core API action is available from `bin/cli.mjs` | `bin/cli.mjs` | M | Invented |
| API-078 | Copy as fetch snippet | The API explorer can copy a request as a browser `fetch` example | `public/app.js` | S | NN/G |
| API-079 | OpenAPI diff gate | Fail CI when a change removes a route, field, or status code | `.github/workflows/` | M | PROBLEM |
| API-080 | API changelog | A human-readable log of contract changes per release | `docs/` | S | PROBLEM |
