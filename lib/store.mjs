import { readFile, writeFile, mkdir, rename, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

// Genesis prevHash for the first record in the audit hash chain (#14).
const AUDIT_GENESIS = '0'.repeat(64);

function auditHash(prevHash, body) {
  return createHash('sha256').update(prevHash + JSON.stringify(body)).digest('hex');
}

// On-disk schema version. Bump when the shape of state.json changes and add a
// migration from the previous version. Legacy stores with no `version` field
// are treated as version 0.
export const SCHEMA_VERSION = 1;

// Migrations are keyed by the version they upgrade FROM. Each receives the
// parsed data object and returns it (mutated in place or replaced). Run in
// ascending order until SCHEMA_VERSION is reached. A store is backed up to
// `<path>.bak` before any migration mutates it, so a bad migration is recoverable.
const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    run(data) {
      // v1: normalize top-level collections that older snapshots may omit or
      // store with the wrong type, and stamp every run with the schema version.
      if (!data.conversations || typeof data.conversations !== 'object' || Array.isArray(data.conversations)) data.conversations = {};
      if (!Array.isArray(data.memories)) data.memories = [];
      if (!data.runs || typeof data.runs !== 'object' || Array.isArray(data.runs)) data.runs = {};
      if (!data.events || typeof data.events !== 'object' || Array.isArray(data.events)) data.events = {};
      if (!data.checkpoints || typeof data.checkpoints !== 'object' || Array.isArray(data.checkpoints)) data.checkpoints = {};
      if (!Array.isArray(data.capabilities)) data.capabilities = [];
      if (!Array.isArray(data.wants)) data.wants = [];
      if (!Array.isArray(data.world)) data.world = [];
      if (!Array.isArray(data.audit)) data.audit = [];
      return data;
    },
  },
];

export class Store {
  constructor(path) {
    this.path = path;
    this.data = { version: SCHEMA_VERSION, conversations: {}, memories: [], runs: {}, events: {}, checkpoints: {}, capabilities: [], wants: [], world: [], audit: [] };
    // Serialize writes: overlapping save() calls used to collide on a single
    // fixed tmp filename (pid-based) and one rename would ENOENT another. We
    // chain through a promise and use a unique tmp per write so concurrent
    // callers (including fire-and-forget ones) queue instead of racing.
    this._saveChain = Promise.resolve();
    this._saveSeq = 0;
  }

  get version() { return this.data.version ?? 0; }

  async load() {
    let raw;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return this; // fresh store, defaults already set
      throw e;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Corrupt store: preserve the bad file and start fresh rather than crash.
      const bak = `${this.path}.corrupt.${Date.now()}`;
      try { await copyFile(this.path, bak); } catch { /* best effort */ }
      throw new Error(`state.json is corrupt (preserved at ${bak}): ${e.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('state.json is not a JSON object');
    }

    // Detect the on-disk version from the raw parsed data BEFORE merging
    // defaults, otherwise a legacy store (no version field) would inherit the
    // default version and skip migration entirely.
    let from = parsed.version == null ? 0 : Number(parsed.version);
    if (!Number.isInteger(from) || from < 0) from = 0;

    this.data = { ...this.data, ...parsed };

    // Migrate forward to the current schema, backing up before mutating.
    if (from > SCHEMA_VERSION) {
      throw new Error(`state.json version ${from} is newer than supported (${SCHEMA_VERSION}); refusing to downgrade`);
    }
    if (from < SCHEMA_VERSION) {
      try { await copyFile(this.path, `${this.path}.bak`); } catch { /* best effort */ }
      for (const m of MIGRATIONS) {
        if (m.from === from) { this.data = m.run(this.data) ?? this.data; from = m.to; }
      }
      this.data.version = SCHEMA_VERSION;
      await this.save();
    }
    return this;
  }

  save() {
    const seq = ++this._saveSeq;
    const tmp = `${this.path}.${process.pid}.${seq}.tmp`;
    // Serialize: each call waits for the previous save to finish, then writes
    // its own unique tmp and atomically renames. Snapshot the data at call time
    // so a queued write reflects state when it was requested, not later.
    const snapshot = JSON.stringify({ ...this.data, version: SCHEMA_VERSION }, null, 2);
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(tmp, snapshot);
      await rename(tmp, this.path);
    };
    this._saveChain = this._saveChain.then(write, write);
    return this._saveChain;
  }

  // Resolve once all queued writes have completed. Used by graceful shutdown
  // to flush the store before exit.
  async flush() { await this._saveChain; }

  listConversations(user = 'anon') { return Object.values(this.data.conversations).filter((c) => !user || c.user === user).sort((a, b) => b.createdAt - a.createdAt); }
  getConversation(id) { return this.data.conversations[id] ?? null; }

  async createConversation({ agentId, title, user = 'anon', provider }) {
    const id = crypto.randomUUID();
    const c = { id, agentId, user, provider, title: title?.trim() || 'New conversation', createdAt: Date.now(), messages: [] };
    this.data.conversations[id] = c;
    await this.save();
    return c;
  }

  async appendMessage(id, message) {
    const c = this.data.conversations[id];
    if (!c) throw new Error('conversation not found');
    const m = { ...message, ts: message.ts ?? Date.now() };
    c.messages.push(m);
    await this.save();
    return m;
  }

  listMemories(user = 'anon') { return this.data.memories.filter((m) => !user || m.user === user); }
  async addMemoryRecord(mem) { this.data.memories.push(mem); await this.save(); return mem; }

  createRun({ conversationId, provider, user = 'anon' }) {
    const id = crypto.randomUUID();
    this.data.runs[id] = { id, conversationId, provider, user, status: 'running', createdAt: Date.now() };
    this.data.events[id] = [];
    return this.data.runs[id];
  }
  getRun(id) { return this.data.runs[id] ?? null; }
  appendEvent(runId, evt) {
    const events = this.data.events[runId] ?? [];
    const record = { ...evt, seq: events.length + 1, ts: Date.now() };
    events.push(record);
    this.data.events[runId] = events;
    return record;
  }
  listEvents(runId) { return this.data.events[runId] ?? []; }
  async finishRun(runId, { status, error }) {
    const r = this.data.runs[runId];
    if (!r) return;
    r.status = status;
    r.finishedAt = Date.now();
    if (error) r.error = error;
    await this.save();
  }

  async saveCheckpoint(runId, node, data) {
    this.data.checkpoints[`${runId}:${node}`] = { runId, node, data, ts: Date.now() };
    await this.save();
  }
  getCheckpoint(runId, node) { return this.data.checkpoints[`${runId}:${node}`] ?? null; }

  async registerCapability(cap) {
    if (!this.data.capabilities.find((c) => c.id === cap.id)) { this.data.capabilities.push(cap); await this.save(); }
    return cap;
  }
  listCapabilities() { return [...this.data.capabilities]; }

  async listAudit({ limit = 100 } = {}) { return (this.data.audit ?? []).slice(-limit).reverse(); }

  // Append an audit record to a tamper-evident hash chain (#14). Each record
  // carries prevHash (the previous record's hash) and hash (sha256 of
  // prevHash + the record body). Any mutation to a past record breaks every
  // subsequent hash, so verifyAuditChain() detects tampering offline.
  async writeAudit(record) {
    this.data.audit = this.data.audit ?? [];
    const prevHash = this.data.audit.length
      ? this.data.audit[this.data.audit.length - 1].hash ?? AUDIT_GENESIS
      : AUDIT_GENESIS;
    const { hash: _h, prevHash: _p, seq: _s, ...body } = record;
    const seq = this.data.audit.length + 1;
    const ts = record.ts ?? Date.now();
    const hash = auditHash(prevHash, { ...body, seq, ts });
    const entry = { ...record, seq, ts, prevHash, hash };
    this.data.audit.push(entry);
    await this.save();
    return entry;
  }

  // Verify the audit hash chain end-to-end. Returns { ok, count } or
  // { ok: false, brokenAt, reason }. Records written before the chain feature
  // (no hash field) cause verification to report brokenAt at that index.
  verifyAuditChain() {
    const chain = this.data.audit ?? [];
    let prev = AUDIT_GENESIS;
    for (let i = 0; i < chain.length; i++) {
      const e = chain[i];
      if (!e.hash) return { ok: false, brokenAt: i, reason: 'missing hash (pre-chain record)' };
      if (e.prevHash !== prev) return { ok: false, brokenAt: i, reason: 'prevHash mismatch' };
      const { hash: _h, prevHash: _p, ...body } = e;
      const expect = auditHash(prev, body);
      if (e.hash !== expect) return { ok: false, brokenAt: i, reason: 'hash mismatch' };
      prev = e.hash;
    }
    return { ok: true, count: chain.length };
  }
}