# Tools, connectors, and MCP — 90 ideas

Tools are the only way a run affects the world, so this category covers capability
design, execution guards, and the connector surface. Today there are five tools
(calculator, clock, remember, recall, storyboard, sd_generate) and a deterministic L1 gate.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| TOOL-001 | Tool manifest schema | One declarative object per tool: name, version, schema, scopes, risk, cost, timeout | `lib/tools.mjs` | M | MCP |
| TOOL-002 | Description style guide | Documented rules for names, verbs, when-to-use text, and boundary cases | `docs/` | S | AN/tools |
| TOOL-003 | Argument JSON Schema | Validate every call against a schema before execution, not inside the tool | `lib/tools.mjs` | S | MCP |
| TOOL-004 | Tool examples | One good call and one near-miss example per tool in the prompt | `lib/tools.mjs` | S | AN/tools |
| TOOL-005 | Error contract | Every tool returns a normalized error with code, retryable, and safe message | `lib/tools.mjs` | S | MCP |
| TOOL-006 | Error code catalog | Stable codes such as INVALID_ARG, NOT_FOUND, RATE_LIMITED, DENIED | `lib/tools.mjs` | S | Invented |
| TOOL-007 | Retryability flag | Declare whether an error is safe to retry automatically | `lib/tools.mjs` | S | TEMPORAL |
| TOOL-008 | Idempotency flag | Declare whether repeated calls with the same key are harmless | `lib/tools.mjs` | S | TEMPORAL |
| TOOL-009 | Read-only annotation | Mark tools that cannot mutate state and allow them without approval | `lib/tools.mjs` | S | MCP |
| TOOL-010 | Destructive annotation | Mark tools that can delete or publish and force approval | `lib/tools.mjs` | S | MCP |
| TOOL-011 | Open-world annotation | Mark tools that reach the public internet and apply stricter egress rules | `lib/tools.mjs` | S | MCP |
| TOOL-012 | Cost estimate | Per-call estimated cost in tokens or currency for budgeting | `lib/tools.mjs` | S | Invented |
| TOOL-013 | Latency estimate | Expected p50 and p95 latency to inform scheduling | `lib/tools.mjs` | S | OBS |
| TOOL-014 | Rate-limit metadata | Per-tool and per-provider limits used by the scheduler | `lib/tools.mjs` | S | K8S |
| TOOL-015 | Scope requirements | Declare required scopes such as net:read or media:generate | `lib/policy.mjs` | M | OWASP |
| TOOL-016 | Approval requirement | A tool can require approval for every call or only above a size threshold | `lib/policy.mjs` | M | OPENAI/agents |
| TOOL-017 | Dry-run implementation | Each tool can describe what it would do without doing it | `lib/tools.mjs` | M | OPENAI/agents |
| TOOL-018 | Result envelope | Standard shape with ok, data, error, duration, and evidence refs | `lib/tools.mjs` | S | MCP |
| TOOL-019 | Structured content | Return machine-readable content alongside human text | `lib/tools.mjs` | S | MCP |
| TOOL-020 | Content blocks | Support text, image, and resource-link blocks in one result | `lib/tools.mjs` | M | MCP |
| TOOL-021 | Result size cap | Truncate at a configured byte limit and say so explicitly | `lib/tools.mjs` | S | AN/context |
| TOOL-022 | Artifact handles | Put large results in the artifact store and return a handle and summary | `lib/store.mjs` | M | AN/context |
| TOOL-023 | Pagination | Cursor-based pagination for list-producing tools | `lib/tools.mjs` | S | MCP |
| TOOL-024 | Progress reporting | Tools can emit 0–100 progress events for long operations | `lib/tools.mjs` | M | MCP |
| TOOL-025 | Cancellation | Pass an abort signal into every tool and require cooperative cancellation | `lib/tools.mjs` | M | MCP |
| TOOL-026 | Per-tool timeout | Enforce a hard timeout with a typed timeout error | `lib/tools.mjs` | S | TEMPORAL |
| TOOL-027 | Per-tool concurrency | Limit simultaneous calls to protect providers and local resources | `lib/tools.mjs` | S | K8S |
| TOOL-028 | Memoization | Cache pure results keyed by tool, version, and normalized args | `lib/tools.mjs` | S | Invented |
| TOOL-029 | Cache-key normalization | Sort object keys and normalize whitespace before hashing args | `lib/tools.mjs` | S | Invented |
| TOOL-030 | Duplicate-call suppression | Within one turn, merge identical calls and fan the result out | `lib/orchestrator.mjs` | S | Invented |
| TOOL-031 | Input size limits | Reject oversized strings and arrays before the tool runs | `lib/tools.mjs` | S | OWASP |
| TOOL-032 | Output sanitization | Strip control characters and invisible unicode from every result | `lib/security.mjs` | S | OWASP |
| TOOL-033 | SSRF guard | Resolve, validate, and pin outbound HTTP targets against private ranges | `lib/security.mjs` | M | OWASP |
| TOOL-034 | Domain allowlist | Explicit allowlist of fetchable domains with per-domain policy | `lib/security.mjs` | M | OWASP |
| TOOL-035 | Redirect limits | Cap redirects, re-validate each hop, and refuse cross-origin downgrades | `lib/security.mjs` | S | OWASP |
| TOOL-036 | DNS pinning | Resolve once, validate the address, and connect to that address | `lib/security.mjs` | L | OWASP |
| TOOL-037 | Scheme allowlist | Permit only https for outbound tools, with explicit exceptions | `lib/security.mjs` | S | OWASP |
| TOOL-038 | Content-type validation | Reject responses whose type does not match the tool's expectation | `lib/tools.mjs` | S | OWASP |
| TOOL-039 | Response byte cap | Stream and stop at a hard byte limit instead of buffering everything | `lib/tools.mjs` | M | OWASP |
| TOOL-040 | Decompression bomb guard | Cap decompressed size and ratio for gzip and zip inputs | `lib/security.mjs` | S | OWASP |
| TOOL-041 | Archive extraction guard | Block path traversal, absolute paths, symlinks, and excessive file counts | `lib/security.mjs` | M | OWASP |
| TOOL-042 | HTML sanitization | Allowlist tags and attributes for any rendered tool output | `lib/security.mjs` | M | OWASP |
| TOOL-043 | SVG sanitization | Strip scripts, foreignObject, and external references from SVG | `lib/security.mjs` | M | OWASP |
| TOOL-044 | Markdown image exfil guard | Refuse remote images in model-authored markdown unless proxied | `lib/security.mjs` | S | OWASP |
| TOOL-045 | CSV injection guard | Prefix formula-leading characters in exported cells | `lib/security.mjs` | S | OWASP |
| TOOL-046 | YAML safe load | Parse YAML with a restricted subset and no custom tags | `lib/tools.mjs` | M | OWASP |
| TOOL-047 | XML entity guard | Disable external entities and cap expansion | `lib/tools.mjs` | S | OWASP |
| TOOL-048 | ReDoS guard | Run user-supplied regex with a length cap and a time budget | `lib/tools.mjs` | S | OWASP |
| TOOL-049 | Artifact path guard | Constrain artifact reads to the run's directory with realpath checks | `lib/store.mjs` | S | OWASP |
| TOOL-050 | Media validation | Verify magic bytes, dimensions, and duration before accepting media | `lib/tools.mjs` | M | OWASP |
| TOOL-051 | Calculator extensions | Add percentages, powers, roots, and constants to the existing parser | `lib/tools.mjs` | S | Invented |
| TOOL-052 | Unit conversion | Length, mass, temperature, data size, and time with exact factors | `lib/tools.mjs` | S | Invented |
| TOOL-053 | Currency conversion | Rates from an allowlisted source with a timestamp and cached fallback | `lib/tools.mjs` | M | Invented |
| TOOL-054 | Timezone tool | Convert and format times across IANA zones without dependencies | `lib/tools.mjs` | S | Invented |
| TOOL-055 | Date arithmetic | Add business days, compute durations, and parse common formats | `lib/tools.mjs` | S | Invented |
| TOOL-056 | Statistics tool | Mean, median, quantiles, variance, correlation, and outlier flags | `lib/tools.mjs` | S | Invented |
| TOOL-057 | Safe regex tool | Match and replace with caps and a clear explanation of the pattern | `lib/tools.mjs` | S | Invented |
| TOOL-058 | Diff tool | Unified diff and a structured change list between two texts | `lib/tools.mjs` | S | Invented |
| TOOL-059 | Text search tool | Literal and regex search over provided text with context lines | `lib/tools.mjs` | S | Invented |
| TOOL-060 | JSON query tool | A small JSONPath-like selector with depth and result limits | `lib/tools.mjs` | M | Invented |
| TOOL-061 | CSV query tool | Filter, project, sort, and aggregate CSV with a row cap | `lib/tools.mjs` | M | Invented |
| TOOL-062 | Markdown tool | Render, sanitize, and extract headings, links, and tables | `lib/tools.mjs` | S | Invented |
| TOOL-063 | Template tool | Render a named template with validated variables | `lib/tools.mjs` | S | Invented |
| TOOL-064 | SVG chart tool | Generate bar, line, and scatter charts as sanitized SVG | `lib/tools.mjs` | M | Invented |
| TOOL-065 | Diagram tool | Generate Mermaid source and a safe server-side SVG rendering path | `lib/tools.mjs` | M | Invented |
| TOOL-066 | QR code tool | Generate a QR code as an SVG data block | `lib/tools.mjs` | S | Invented |
| TOOL-067 | URL metadata tool | Fetch title, description, and canonical URL with SSRF and size guards | `lib/tools.mjs` | M | Invented |
| TOOL-068 | Readability extraction | Extract main article text and drop navigation and ads | `lib/tools.mjs` | M | RAG |
| TOOL-069 | Robots.txt respect | Cache and honor robots rules per domain for fetch tools | `lib/tools.mjs` | M | OWASP |
| TOOL-070 | Conditional HTTP cache | Use ETag and Last-Modified to avoid refetching unchanged pages | `lib/tools.mjs` | S | Invented |
| TOOL-071 | Feed reader | Parse RSS and Atom with item limits and date normalization | `lib/tools.mjs` | S | Invented |
| TOOL-072 | Web search connector | An optional, allowlisted search adapter with query and result caps | `lib/tools.mjs` | M | Invented |
| TOOL-073 | Sitemap reader | Discover and cap URLs from a sitemap for scoped crawling | `lib/tools.mjs` | S | Invented |
| TOOL-074 | GitHub read connector | Read issues, pull requests, and file contents through the API | `lib/tools.mjs` | M | Invented |
| TOOL-075 | GitHub write connector | Open issues or comments only after explicit approval | `lib/tools.mjs` | M | OPENAI/agents |
| TOOL-076 | Docs connector | Ingest an allowlisted documentation site into memory with provenance | `lib/tools.mjs` | L | RAG |
| TOOL-077 | Calendar connector | Read availability and propose slots without creating events | `lib/tools.mjs` | L | OPENAI/agents |
| TOOL-078 | Email draft connector | Compose a draft, never send, and hand it to a human | `lib/tools.mjs` | M | OPENAI/agents |
| TOOL-079 | Signed webhook sender | Send an HMAC-signed payload to an allowlisted endpoint with retries | `lib/tools.mjs` | M | INNGEST |
| TOOL-080 | Read-only SQL connector | Query an allowlisted database with a statement timeout and row cap | `lib/tools.mjs` | L | OWASP |
| TOOL-081 | Vector search tool | Expose memory search as a tool with filters and citation output | `lib/tools.mjs` | S | RAG |
| TOOL-082 | Task tool | Create, list, and complete todos inside a run | `lib/tools.mjs` | S | OPENAI/agents |
| TOOL-083 | Reminder tool | Schedule a notification through the durable timer system | `lib/tools.mjs` | M | INNGEST |
| TOOL-084 | Notification tool | Post to an allowlisted channel with rate limits and redaction | `lib/tools.mjs` | M | OWASP |
| TOOL-085 | Artifact reader | Read a run artifact by id with a byte cap and provenance | `lib/tools.mjs` | S | AN/context |
| TOOL-086 | Image edit tool | Extend `sd_generate` with size, seed, and negative-prompt controls | `lib/tools.mjs` | M | Invented |
| TOOL-087 | PDF export tool | Render a deliverable to PDF through a documented optional adapter | `lib/tools.mjs` | M | Invented |
| TOOL-088 | MCP client | Connect to allowlisted MCP servers over stdio or streamable HTTP | `lib/mcp.mjs` | L | MCP |
| TOOL-089 | MCP server mode | Expose Agent Village capabilities as MCP tools with scoped auth | `server.mjs` | L | MCP |
| TOOL-090 | MCP hardening set | Hash-pin tool definitions, prevent shadowing, and validate annotations | `lib/mcp.mjs` | M | MCP/security |
