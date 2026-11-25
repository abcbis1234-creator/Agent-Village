# Memory and knowledge — 90 ideas

Memory is currently four types (episodic, semantic, procedural, core), hashed embeddings,
importance, decay, reflection, and correction. These rows turn it into a retrieval system
that can explain itself, forget on request, and survive contradictions.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| MEM-001 | Hybrid retrieval | Combine cosine similarity with BM25 so exact names and rare terms are not lost | `lib/memory.mjs` | M | RAG |
| MEM-002 | In-process BM25 index | Build an inverted index over memory text with incremental updates and delete support | `lib/memory.mjs` | M | RAG |
| MEM-003 | Heuristic reranker | Rerank the top 50 candidates with tag overlap, recency, importance, and source trust | `lib/archivist.mjs` | S | RAG |
| MEM-004 | Query expansion | Expand a query with curated synonyms and acronyms before retrieval | `lib/memory.mjs` | S | RAG |
| MEM-005 | HyDE retrieval | Generate a hypothetical answer, embed it, and retrieve against that vector | `lib/archivist.mjs` | M | HYDE |
| MEM-006 | Multi-query retrieval | Issue three paraphrases and merge results with reciprocal rank fusion | `lib/archivist.mjs` | M | RAG |
| MEM-007 | MMR diversity | Penalize near-duplicate results so one incident cannot fill the context window | `lib/memory.mjs` | S | RAG |
| MEM-008 | Metadata filters | Filter by type, tag, user, project, time range, and confidence before ranking | `lib/memory.mjs` | S | LETTA |
| MEM-009 | Memory scopes | First-class user, project, run, and global namespaces with inheritance rules | `lib/store.mjs` | M | MEM0 |
| MEM-010 | Memory ACLs | Per-scope read and write permissions checked on every recall and record | `lib/memory.mjs` | M | OWASP |
| MEM-011 | Per-memory TTL | Expire ephemeral memories automatically while keeping pinned ones | `lib/archivist.mjs` | S | LETTA |
| MEM-012 | Salience score | Combine importance, recency, access frequency, and feedback into one score | `lib/archivist.mjs` | M | GENAGENTS |
| MEM-013 | Recency boost | Tunable exponential recency weighting with a per-type half-life | `lib/archivist.mjs` | S | GENAGENTS |
| MEM-014 | Usage reinforcement | Increase salience when a memory is retrieved and cited successfully | `lib/archivist.mjs` | S | GENAGENTS |
| MEM-015 | Write-time importance rubric | Ask the model for importance with anchors instead of a bare 1–5 integer | `lib/agents.mjs` | S | GENAGENTS |
| MEM-016 | Near-duplicate collapse | Detect and merge memories above a similarity threshold at write time | `lib/archivist.mjs` | M | MEM0 |
| MEM-017 | Consolidation pass | Merge clusters of related episodic memories into one semantic summary | `lib/archivist.mjs` | M | AN/memory |
| MEM-018 | Reflection summaries | Periodically synthesize higher-level insights from recent memories | `lib/archivist.mjs` | M | GENAGENTS |
| MEM-019 | Dream cycle | A scheduled offline pass that reorganizes, corrects, and prunes memory | `lib/archivist.mjs` | L | AN/memory |
| MEM-020 | Correction lineage | Keep the superseded memory, the correction, and the reason linked as a chain | `lib/archivist.mjs` | S | AN/memory |
| MEM-021 | Contradiction detection | Flag memories that assert incompatible facts about the same entity | `lib/archivist.mjs` | M | ZEP |
| MEM-022 | Validity intervals | Give each fact a not-before and not-after timestamp instead of a single created time | `lib/archivist.mjs` | M | ZEP |
| MEM-023 | As-of queries | Answer "what did we believe on date X" using validity intervals | `lib/archivist.mjs` | M | ZEP |
| MEM-024 | Entity extraction | Extract people, projects, tools, and artifacts into a canonical entity table | `lib/archivist.mjs` | M | COGNEE |
| MEM-025 | Entity cards | One page per entity with facts, aliases, relationships, and source memories | `lib/archivist.mjs` | M | COGNEE |
| MEM-026 | Knowledge graph edges | Store typed edges such as works-on, depends-on, supersedes, and caused-by | `lib/store.mjs` | M | COGNEE |
| MEM-027 | Graph-assisted recall | Expand retrieval one hop along high-confidence edges when the query names an entity | `lib/archivist.mjs` | M | COGNEE |
| MEM-028 | Relation vocabulary | A small controlled vocabulary for edges to prevent ontology drift | `lib/archivist.mjs` | S | COGNEE |
| MEM-029 | Provenance refs | Every memory points to the run, event, or document span that produced it | `lib/archivist.mjs` | S | AN/memory |
| MEM-030 | Confidence per memory | Store confidence separately from importance and use it in ranking | `lib/archivist.mjs` | S | ZEP |
| MEM-031 | Source trust scores | Weight memories by the reliability of their source, with manual overrides | `lib/archivist.mjs` | M | Invented |
| MEM-032 | Citation spans | Store the exact text span supporting a fact, not just a document id | `lib/archivist.mjs` | M | RAG |
| MEM-033 | Memory citations in answers | Reviewer must cite memory ids for claims that rely on history | `lib/orchestrator.mjs` | M | RAG |
| MEM-034 | Token-budget packing | Pack the highest-value memories into a fixed token budget with a greedy knapsack | `lib/archivist.mjs` | M | AN/context |
| MEM-035 | Deduplicated context packing | Never include the same fact twice from different memories in one prompt | `lib/archivist.mjs` | S | AN/context |
| MEM-036 | Summary tree | Build hierarchical summaries so broad questions retrieve a parent, not fifty leaves | `lib/archivist.mjs` | L | RAPTOR |
| MEM-037 | Rolling conversation summary | Maintain a compact summary updated every N turns for long sessions | `lib/archivist.mjs` | S | AN/context |
| MEM-038 | Chunking strategies | Pluggable fixed, sentence, paragraph, and heading-aware chunkers | `lib/memory.mjs` | M | RAG |
| MEM-039 | Chunk overlap control | Configure overlap per strategy and store offsets for citation | `lib/memory.mjs` | S | RAG |
| MEM-040 | Code-aware chunking | Split code by function and keep imports with the body | `lib/memory.mjs` | M | AN/skills |
| MEM-041 | Table extraction | Convert markdown and CSV tables into structured rows before embedding | `lib/memory.mjs` | M | RAG |
| MEM-042 | Embedding upgrade path | Version embedding models and lazily re-embed when the version changes | `lib/memory.mjs` | M | Invented |
| MEM-043 | Tiny HNSW index | A dependency-free approximate nearest-neighbor index with tunable ef | `lib/memory.mjs` | L | RAG |
| MEM-044 | LSH candidate index | Locality-sensitive hashing for cheap candidate generation on large stores | `lib/memory.mjs` | M | RAG |
| MEM-045 | Int8 quantization | Store quantized vectors with rescoring to cut memory use by roughly 4x | `lib/memory.mjs` | M | RAG |
| MEM-046 | Incremental indexing | Update the index on write instead of rebuilding on every search | `lib/memory.mjs` | M | RAG |
| MEM-047 | Deletion tombstones | Remove vectors lazily and compact the index on a schedule | `lib/memory.mjs` | S | RAG |
| MEM-048 | Index rebuild command | CLI command to rebuild all indexes with progress and a verification pass | `bin/cli.mjs` | S | RAG |
| MEM-049 | Index consistency check | Compare vector count and ids against the store and report drift | `lib/memory.mjs` | S | RAG |
| MEM-050 | Memory export | Export memories with provenance and validity intervals as JSONL | `server.mjs` | S | OWASP |
| MEM-051 | Markdown import | Import notes with front matter and heading structure into semantic memory | `lib/archivist.mjs` | M | RAG |
| MEM-052 | JSONL import | Bulk import with validation, dedupe, and a dry-run report | `lib/archivist.mjs` | S | RAG |
| MEM-053 | Memory browser | Search, filter, and inspect memories with provenance in the UI | `public/app.js` | M | LETTA |
| MEM-054 | Memory search API | Paginated, filtered recall endpoint separate from the agent tool | `server.mjs` | S | LETTA |
| MEM-055 | Memory diff view | Show how a memory changed across corrections and consolidations | `public/app.js` | M | ZEP |
| MEM-056 | Memory pinning | Pin facts that must never decay or be consolidated away | `lib/archivist.mjs` | S | LETTA |
| MEM-057 | Forget button | User-initiated deletion with a preview of dependent memories | `public/app.js` | S | OWASP |
| MEM-058 | Forget-request workflow | Queue, review, approve, and audit deletion requests for shared memories | `server.mjs` | M | OWASP |
| MEM-059 | Memory quarantine | Hold suspicious writes for review instead of storing them immediately | `lib/archivist.mjs` | M | OWASP |
| MEM-060 | Poisoning detection | Flag memories that contain instruction-like text or sudden topic shifts | `lib/security.mjs` | M | OWASP |
| MEM-061 | Source allowlist | Only accept memory writes from trusted roles, users, or connectors | `lib/archivist.mjs` | S | OWASP |
| MEM-062 | Human review queue | Low-confidence or high-impact memories require approval before use | `server.mjs` | M | OWASP |
| MEM-063 | Memory audit log | Append every read, write, correction, and deletion to the audit chain | `lib/store.mjs` | S | OWASP |
| MEM-064 | Memory usage telemetry | Count retrievals and citations per memory id without storing query text | `lib/metrics.mjs` | S | OBS |
| MEM-065 | Memory ROI | Estimate value per token by tracking which memories led to accepted claims | `lib/metrics.mjs` | L | Invented |
| MEM-066 | Retrieval hit rate | Track the fraction of queries with at least one cited result | `lib/metrics.mjs` | S | OBS |
| MEM-067 | Retrieval miss log | Record queries with no useful result to drive content and index fixes | `lib/archivist.mjs` | S | OBS |
| MEM-068 | Retrieval eval set | A labeled set of query-to-expected-memory pairs run in CI | `eval/` | M | AN/evals |
| MEM-069 | Recall and precision tests | Assert recall@k and precision@k thresholds for the eval set | `tests/` | S | AN/evals |
| MEM-070 | Forgetting correctness tests | Assert decayed and expired memories are excluded from recall | `tests/` | S | AN/evals |
| MEM-071 | Stale-memory detector | Find memories contradicted by newer evidence and mark them for review | `lib/archivist.mjs` | M | AN/memory |
| MEM-072 | Canonical fact registry | One authoritative value per key fact with a pointer to the winning memory | `lib/store.mjs` | M | ZEP |
| MEM-073 | Preference store | Structured user preferences with confidence and last-confirmed time | `lib/archivist.mjs` | S | MEM0 |
| MEM-074 | User profile memory | A compact, editable profile assembled from preferences and history | `lib/archivist.mjs` | M | MEM0 |
| MEM-075 | Task memory | Reusable task patterns with preconditions and observed success rates | `lib/archivist.mjs` | M | VOYAGER |
| MEM-076 | Failure memory | Store failure signatures and the fix that worked, keyed by error class | `lib/archivist.mjs` | S | REFLEXION |
| MEM-077 | Lesson store | Human-readable lessons linked to the runs that produced them | `lib/archivist.mjs` | S | REFLEXION |
| MEM-078 | Playbook store | Versioned procedural playbooks that the Planner can retrieve by intent | `lib/archivist.mjs` | M | AN/skills |
| MEM-079 | Skill cards | Extract a reusable skill card from a successful run with inputs and checks | `lib/archivist.mjs` | M | VOYAGER |
| MEM-080 | Semantic cache | Cache model answers keyed by normalized intent plus evidence hash | `lib/llm.mjs` | M | Invented |
| MEM-081 | Exact response cache | Hash the full request for deterministic replay and cost savings | `lib/llm.mjs` | S | Invented |
| MEM-082 | Cache invalidation | Invalidate cached answers when the prompt version or model changes | `lib/llm.mjs` | S | Invented |
| MEM-083 | Cache privacy isolation | Partition every cache key by user and never serve across tenants | `lib/llm.mjs` | S | OWASP |
| MEM-084 | Shared memory bus | Let agents publish and subscribe to memory updates within a run | `lib/bus.mjs` | M | Invented |
| MEM-085 | Memory contracts | Declare what each role may read and write as part of its agent definition | `lib/agents.mjs` | S | Invented |
| MEM-086 | Memory schema version | Version memory records and migrate old shapes on read | `lib/store.mjs` | S | ZEP |
| MEM-087 | Memory backup | Snapshot memories separately from runs for faster restore | `lib/store.mjs` | S | OWASP |
| MEM-088 | Memory compaction | Merge duplicate entities and prune orphan edges without losing provenance | `lib/archivist.mjs` | M | COGNEE |
| MEM-089 | Cold memory tier | Move rarely used memories to a slower file and load on demand | `lib/store.mjs` | M | LETTA |
| MEM-090 | Redaction before recall | Strip secrets and personal data at retrieval time as well as at write time | `lib/security.mjs` | S | OWASP |
