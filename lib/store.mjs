import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    this.path = path;
    this.data = { conversations: {}, memories: [], runs: {}, events: {}, checkpoints: {}, workflowStates: {}, capabilities: [] };
    this._saveQueue = Promise.resolve();
  }

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.data = { ...this.data, ...parsed };
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return this;
  }

  // Saves are serialized: concurrent callers share one tmp path, so the
  // second rename would otherwise hit ENOENT after the first moved the file.
  async save() {
    const run = this._saveQueue.then(() => this._saveOnce());
    this._saveQueue = run.catch(() => {});
    return run;
  }

  async _saveOnce() {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.path);
  }

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
  listCheckpoints(runId) {
    return Object.values(this.data.checkpoints ?? {}).filter((c) => c.runId === runId).sort((a, b) => a.ts - b.ts);
  }
  async saveWorkflowState(runId, state) {
    this.data.workflowStates[runId] = { ...state, runId, ts: Date.now() };
    await this.save();
    return this.data.workflowStates[runId];
  }
  getWorkflowState(runId) { return this.data.workflowStates?.[runId] ?? null; }

  async registerCapability(cap) {
    if (!this.data.capabilities.find((c) => c.id === cap.id)) { this.data.capabilities.push(cap); await this.save(); }
    return cap;
  }
  listCapabilities() { return [...this.data.capabilities]; }

  async listAudit({ limit = 100 } = {}) { return (this.data.audit ?? []).slice(-limit).reverse(); }
  async writeAudit(record) {
    this.data.audit = this.data.audit ?? [];
    this.data.audit.push(record);
    await this.save();
  }
}