# Durability, recovery, and storage — 80 ideas

Everything needed for a run to survive a restart, a crash, a bad deploy, or a human
pause without losing work or repeating side effects. Current building blocks live in
`lib/store.mjs`, `lib/workflow.mjs`, and the suspend routes in `server.mjs`.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| DUR-001 | Append-only run journal | Write every state transition to an append-only log before mutating the snapshot | `lib/store.mjs` | M | TEMPORAL |
| DUR-002 | Explicit fsync policy | Choose per-write durability: buffered, fsync on checkpoint, or fsync every event | `lib/store.mjs` | S | TEMPORAL |
| DUR-003 | Named checkpoints | Let callers label a checkpoint (pre-approval, post-recon) and resume by name | `lib/store.mjs` | S | LANGGRAPH |
| DUR-004 | Richer checkpoint metadata | Store phase, plan hash, attempt, token usage, and elapsed time with each checkpoint | `lib/store.mjs` | S | TEMPORAL |
| DUR-005 | Incremental checkpoints | Persist only the delta from the previous checkpoint instead of a full snapshot | `lib/store.mjs` | L | TEMPORAL |
| DUR-006 | Compressed checkpoints | Gzip checkpoint bodies above a threshold using `node:zlib` | `lib/store.mjs` | S | TEMPORAL |
| DUR-007 | Checkpoint size guard | Reject or truncate oversized checkpoint fields with a clear error | `lib/store.mjs` | S | K8S |
| DUR-008 | Retention policy | Keep the last N checkpoints plus all named ones, prune the rest | `lib/store.mjs` | S | K8S |
| DUR-009 | Checkpoint garbage collection | Background or on-demand GC for unreferenced checkpoint blobs | `lib/store.mjs` | M | TEMPORAL |
| DUR-010 | Pinned checkpoints | Mark checkpoints immune to retention, useful for incident evidence | `lib/store.mjs` | S | Invented |
| DUR-011 | Fork from checkpoint | Start a new run id that inherits state up to a chosen checkpoint | `lib/orchestrator.mjs` | M | LANGGRAPH |
| DUR-012 | Replay from checkpoint | Re-execute only nodes after a checkpoint with the same inputs | `lib/workflow.mjs` | M | TEMPORAL |
| DUR-013 | Time-travel listing | API and UI list of every checkpoint with a one-line description | `server.mjs`, `public/app.js` | S | LANGGRAPH |
| DUR-014 | Checkpoint diff | Show what changed in state between two checkpoints | `lib/store.mjs` | M | LANGGRAPH |
| DUR-015 | Checkpoint export | Download a single checkpoint as JSON for offline debugging | `server.mjs` | S | Invented |
| DUR-016 | Checkpoint import | Upload a checkpoint into a sandbox run for reproduction | `server.mjs` | M | Invented |
| DUR-017 | Checkpoint checksums | Store a SHA-256 per checkpoint and verify on load | `lib/store.mjs` | S | Invented |
| DUR-018 | Corruption detection | Quarantine unreadable records, keep serving the rest, and report the damage | `lib/store.mjs` | M | K8S |
| DUR-019 | Backup rotation | Keep daily and weekly store backups with a documented restore path | `lib/store.mjs` | M | K8S |
| DUR-020 | Restore command | `bin/cli.mjs` subcommand to restore a backup with a dry-run preview | `bin/cli.mjs` | M | K8S |
| DUR-021 | Checkpoint schema version | Version checkpoint bodies independently from the store schema | `lib/store.mjs` | S | TEMPORAL |
| DUR-022 | Checkpoint migrations | Migrate old checkpoint shapes on read, with fixtures for each version | `lib/store.mjs` | M | TEMPORAL |
| DUR-023 | Downgrade guard | Refuse to load a checkpoint written by a newer schema version | `lib/store.mjs` | S | K8S |
| DUR-024 | Atomic multi-file commit | Commit run, checkpoint, and artifact manifests as one logical transaction | `lib/store.mjs` | L | TEMPORAL |
| DUR-025 | File write locking | Serialize writers within one process with a promise queue per store path | `lib/store.mjs` | S | RESTATE |
| DUR-026 | Single-writer lock file | Prevent two server processes from writing the same data directory | `server.mjs` | S | K8S |
| DUR-027 | Stale lock recovery | Detect a dead owner via pid and start time, then take over safely | `server.mjs` | M | K8S |
| DUR-028 | Lease-based leadership | Time-bounded writer lease renewed by heartbeat for multi-instance deploys | `lib/store.mjs` | L | K8S |
| DUR-029 | Fencing tokens | Reject writes from an expired leader using a monotonically increasing token | `lib/store.mjs` | M | K8S |
| DUR-030 | Run heartbeat | Active runs emit a heartbeat with phase and last progress timestamp | `lib/orchestrator.mjs` | S | TEMPORAL |
| DUR-031 | Crash detection on boot | Scan for runs marked running with no heartbeat and mark them interrupted | `server.mjs` | S | TEMPORAL |
| DUR-032 | Orphan recovery | Expose interrupted runs for resume or compensation instead of leaving them stuck | `server.mjs` | M | TEMPORAL |
| DUR-033 | Auto-resume on restart | Optional policy to resume interrupted runs from their last checkpoint | `server.mjs` | M | TEMPORAL |
| DUR-034 | Drain state persistence | Record draining so a restarted process knows to stay out of the scheduler | `server.mjs` | S | K8S |
| DUR-035 | Shutdown checkpoint | Force a final checkpoint during graceful shutdown for every active run | `server.mjs` | S | TEMPORAL |
| DUR-036 | Hard-kill recovery test | A test that kills the process mid-run and asserts resume from disk | `tests/` | M | TEMPORAL |
| DUR-037 | Deterministic replay harness | Replay recorded events without LLM calls and compare resulting state | `tests/` | M | TEMPORAL |
| DUR-038 | External effect ledger | Record every irreversible tool effect with a key, result, and compensation status | `lib/store.mjs` | M | TEMPORAL |
| DUR-039 | Outbox for side effects | Queue intended effects transactionally, then dispatch with retries | `lib/store.mjs` | L | TEMPORAL |
| DUR-040 | Inbox deduplication | Deduplicate inbound webhooks and approvals by event id before applying | `server.mjs` | S | INNGEST |
| DUR-041 | Exactly-once effect keys | Derive effect keys from run, step, tool, and normalized args | `lib/tools.mjs` | M | TEMPORAL |
| DUR-042 | Compensation registry | Each tool declares how to undo or annotate its effect | `lib/tools.mjs` | M | TEMPORAL |
| DUR-043 | Saga coordinator | Run compensating actions in reverse order when a later step fails | `lib/workflow.mjs` | L | TEMPORAL |
| DUR-044 | Compensation dry-run | Show which compensations would run and what they cannot undo | `lib/workflow.mjs` | S | Invented |
| DUR-045 | Compensation failure path | Escalate to human review when a compensation itself fails | `lib/orchestrator.mjs` | M | TEMPORAL |
| DUR-046 | Dead-letter queue | Park events that exhaust retries with the full failure context | `lib/store.mjs` | M | INNGEST |
| DUR-047 | Retry queue with backoff | Durable scheduled retries that survive a restart | `lib/store.mjs` | M | INNGEST |
| DUR-048 | Durable timers | Wake a run at a wall-clock time even after a process restart | `lib/store.mjs` | L | TEMPORAL |
| DUR-049 | Scheduled runs | Cron-like schedules per mission with timezone and overlap policy | `server.mjs` | L | INNGEST |
| DUR-050 | Wait-for-signal nodes | A workflow node that blocks until a named external signal arrives | `lib/workflow.mjs` | M | TEMPORAL |
| DUR-051 | Wait-for-approval nodes | First-class approval wait with assignee, deadline, and default action | `lib/workflow.mjs` | M | LANGGRAPH |
| DUR-052 | Wait-for-webhook nodes | Resume when a signed webhook with a matching correlation id arrives | `server.mjs` | M | INNGEST |
| DUR-053 | Resume tokens | Short-lived signed tokens that authorize resuming a specific run | `server.mjs` | S | Invented |
| DUR-054 | Cancellation propagation | Cancel cascades from run to phase to node to in-flight tool request | `lib/workflow.mjs` | M | TEMPORAL |
| DUR-055 | Versioned pause protocol | Include a pause protocol version so old clients cannot resume new runs | `server.mjs` | S | LANGGRAPH |
| DUR-056 | Pause reason codes | Distinguish user pause, budget pause, approval wait, and incident pause | `lib/orchestrator.mjs` | S | Invented |
| DUR-057 | Resume preconditions | Validate config, tools, and approvals before resuming, with actionable errors | `lib/orchestrator.mjs` | M | LANGGRAPH |
| DUR-058 | Attempt numbering | Each resume increments an attempt number recorded on every event | `lib/store.mjs` | S | TEMPORAL |
| DUR-059 | Attempt history | Keep a compact per-attempt summary instead of only the latest state | `lib/store.mjs` | S | TEMPORAL |
| DUR-060 | Tool-boundary checkpoints | Checkpoint after every tool call whose result is expensive to recompute | `lib/workflow.mjs` | S | TEMPORAL |
| DUR-061 | Phase-boundary checkpoints | Guarantee a checkpoint exists at every phase transition | `lib/orchestrator.mjs` | S | LANGGRAPH |
| DUR-062 | Pre-effect checkpoint | Force a checkpoint before any irreversible tool runs | `lib/policy.mjs` | S | TEMPORAL |
| DUR-063 | Post-effect checkpoint | Persist the effect result immediately after it returns | `lib/workflow.mjs` | S | TEMPORAL |
| DUR-064 | Budget-threshold checkpoint | Checkpoint before an expensive phase so a budget stop is resumable | `lib/budget.mjs` | S | TEMPORAL |
| DUR-065 | Configurable checkpoint cadence | Per-run cadence: every node, every N nodes, or phase-only | `lib/orchestrator.mjs` | S | TEMPORAL |
| DUR-066 | Last-good pointer | Maintain a pointer to the newest checkpoint that passed integrity checks | `lib/store.mjs` | S | K8S |
| DUR-067 | Rollback to last good | One operation to restore run state to the last-good checkpoint | `lib/store.mjs` | M | K8S |
| DUR-068 | Rollback effect warning | Block rollback when later irreversible effects exist unless explicitly forced | `lib/policy.mjs` | M | TEMPORAL |
| DUR-069 | Run archival | Move completed runs older than N days to an archive file | `lib/store.mjs` | M | K8S |
| DUR-070 | Cold export | Export archived runs as JSONL with a manifest for portability | `bin/cli.mjs` | S | Invented |
| DUR-071 | Old-run import | Import archived runs into a read-only viewer | `bin/cli.mjs` | M | Invented |
| DUR-072 | Run deletion and tombstone | Delete payloads but keep a tombstone for audit and idempotency | `lib/store.mjs` | M | K8S |
| DUR-073 | Erasure cascade | Delete a user's runs, memories, checkpoints, and artifacts in one audited job | `lib/store.mjs` | L | OWASP |
| DUR-074 | PII scrub before archive | Redact likely personal data from archived payloads with a review log | `lib/security.mjs` | M | OWASP |
| DUR-075 | Secret scrub before archive | Reuse the secret scanner on every archived field, not just memory writes | `lib/security.mjs` | S | OWASP |
| DUR-076 | Store compaction | Rewrite the snapshot without tombstones and report bytes reclaimed | `lib/store.mjs` | M | K8S |
| DUR-077 | Store size metrics | Expose snapshot, journal, checkpoint, and artifact sizes | `lib/metrics.mjs` | S | OBS |
| DUR-078 | Lock contention metrics | Count waits and timeouts on store locks to spot multi-instance problems | `lib/metrics.mjs` | S | OBS |
| DUR-079 | Pluggable storage interface | Define get, put, list, and delete so backends can be swapped | `lib/store.mjs` | L | K8S |
| DUR-080 | Optional SQLite backend | Use `node:sqlite` when available for concurrent reads and real transactions | `lib/store.mjs` | L | TEMPORAL |
