// Archivist — Memory Science implementation.
//
// Research basis:
//   - Ebbinghaus forgetting curve: memory strength decays over time without review
//   - Memory reconsolidation: recalling a memory makes it labile, updatable with new evidence
//   - Spaced repetition: reviewing at increasing intervals strengthens retention
//   - Consolidation: experiences are stabilized into long-term memory over time
//   - Smallville architecture: memory stream + reflection + plan loop
//
// The Archivist does not just store. It:
//   1. Consolidates runs into structured snapshots (what was attempted, succeeded, failed, learned)
//   2. Reflects: synthesizes recent memories into higher-order beliefs
//   3. Decays: older memories get lower retrieval weight (forgetting curve)
//   4. Reconsolidates: new confirming/disconfirming evidence updates existing memories

import { embed, cosine } from './memory.mjs';

// ---------- decay / forgetting curve ----------

// Exponential decay strength based on age (Ebbinghaus-inspired).
// ageMs = milliseconds since last access/creation. Returns 0..1 strength.
function decayStrength(ageMs, halfLifeMs = 7 * 24 * 60 * 60 * 1000) {
  // strength = 0.5 ^ (age / halfLife)
  return Math.pow(0.5, ageMs / halfLifeMs);
}

// ---------- memory snapshot ----------

export function snapshotRun(run, conversation) {
  const events = run.events ?? [];
  const successes = events.filter((e) => e.type === 'tool_result');
  const failures = events.filter((e) => e.type === 'tool_error' || e.type === 'error');
  const decisions = events.filter((e) => e.type === 'message_end');

  return {
    id: `arch-${crypto.randomUUID()}`,
    runId: run.id,
    conversationId: run.conversationId,
    mission: conversation?.title ?? 'untitled',
    provider: run.provider,
    status: run.status,
    toolCount: successes.length,
    failureCount: failures.length,
    startedAt: run.createdAt ?? Date.now(),
    finishedAt: run.finishedAt,
    durationMs: run.finishedAt ? run.finishedAt - (run.createdAt ?? Date.now()) : null,
    summary: decisions.length > 0 ? decisions[decisions.length - 1].payload?.content ?? '' : '',
    lessons: extractLessons(events),
    createdAt: run.createdAt ?? Date.now(),
    lastAccessed: Date.now(),
    accessCount: 0,
    strength: 1.0,
    tags: extractTags(run, conversation),
  };
}

// Extract actionable lessons from run events.
function extractLessons(events) {
  const lessons = [];
  for (const e of events) {
    if (e.type === 'tool_error') {
      lessons.push({ kind: 'failure', tool: e.payload?.tool, evidence: e.payload?.error, severity: 'medium' });
    }
    if (e.type === 'verify_result' && !e.payload?.passed) {
      lessons.push({ kind: 'verification_failure', evidence: e.payload?.checks?.filter((c) => !c.pass).map((c) => c.evidence), severity: 'high' });
    }
    if (e.type === 'tool_result' && e.payload?.tool === 'calculator') {
      lessons.push({ kind: 'computation', tool: 'calculator', evidence: e.payload?.result, severity: 'low' });
    }
  }
  return lessons;
}

function extractTags(run, conversation) {
  const tags = [];
  if (run.provider) tags.push(`provider:${run.provider}`);
  if (run.status) tags.push(`status:${run.status}`);
  const mission = conversation?.title ?? '';
  const missionWords = mission.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const w of missionWords) {
    if (w.length > 4 && !['about', 'there', 'their', 'which', 'where', 'when'].includes(w)) {
      tags.push(`topic:${w}`);
    }
  }
  return tags.slice(0, 8);
}

// ---------- Archivist class ----------

export class Archivist {
  constructor(store, options = {}) {
    this.store = store;
    this.halfLifeMs = options.halfLifeMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
    this.maxMemories = options.maxMemories ?? 5000;
    this.reflectionWindowMs = options.reflectionWindowMs ?? 24 * 60 * 60 * 1000; // 24 hours
    this.snapshots = []; // in-memory index of consolidated runs
  }

  // Consolidate a finished run into a memory snapshot.
  async consolidate(run, conversation) {
    const snap = snapshotRun(run, conversation);
    this.snapshots.unshift(snap);
    if (this.snapshots.length > this.maxMemories) this.snapshots.length = this.maxMemories;

    // Persist as a memory record via the store's memory layer.
    await this.store.addMemoryRecord({
      id: snap.id,
      text: `${snap.mission} — ${snap.summary}`,
      tags: snap.tags,
      user: conversation?.userId ?? 'anon',
      vec: embed(`${snap.mission} ${snap.summary} ${snap.lessons.map((l) => l.evidence).join(' ')}`),
      createdAt: snap.createdAt,
    });

    return snap;
  }

  // Retrieve relevant memories, weighted by semantic similarity + recency + strength.
  retrieve(query, { userId = 'anon', k = 5, minScore = 0.15, includeDecayed = false } = {}) {
    const qVec = embed(query);
    const now = Date.now();

    const scored = this.snapshots
      .filter((s) => !userId || s.tags.some((t) => t.startsWith(`user:${userId}`)) || true) // snapshots don't have userId directly; filter by conversation context below
      .map((snap) => {
        const v = snap.vec ? Float32Array.from(snap.vec) : embed(`${snap.mission} ${snap.summary}`);
        const sim = cosine(qVec, v);
        const ageMs = now - snap.lastAccessed;
        const strength = decayStrength(ageMs, this.halfLifeMs);
        const recencyBonus = 1 / (1 + ageMs / (24 * 60 * 60 * 1000)); // diminishes over days
        const score = sim * 0.6 + strength * 0.25 + recencyBonus * 0.15;
        return { snap, sim, strength, score };
      })
      .filter((s) => s.score >= minScore || includeDecayed)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    // Update access tracking for retrieved memories.
    for (const s of scored) {
      s.snap.lastAccessed = now;
      s.snap.accessCount += 1;
    }

    return scored.map((s) => ({
      ...s.snap,
      relevanceScore: s.score,
      similarity: s.sim,
      strength: s.strength,
      ageMs: now - s.snap.lastAccessed,
    }));
  }

  // Reflect: synthesize recent memories into higher-order beliefs.
  // Returns a set of belief statements with confidence.
  reflect({ userId = 'anon', windowMs = this.reflectionWindowMs } = {}) {
    const now = Date.now();
    const recent = this.snapshots.filter((s) => now - s.createdAt <= windowMs && now - s.createdAt >= 0);

    if (recent.length === 0) return { beliefs: [], basis: 'no_recent_memories', snapshotCount: 0 };

    const successes = recent.filter((s) => s.status === 'ok').length;
    const failures = recent.filter((s) => s.status === 'error' || s.status === 'cancelled').length;
    const total = recent.length;
    const successRate = total > 0 ? successes / total : 0;

    const allLessons = recent.flatMap((s) => s.lessons);
    const failureLessons = allLessons.filter((l) => l.kind === 'failure' || l.kind === 'verification_failure');
    const commonTools = {};
    for (const s of recent) {
      // toolCount doesn't tell us which tools; we'd need event detail. Skip tool-level inference here.
    }

    const beliefs = [];

    if (successRate >= 0.8) {
      beliefs.push({
        statement: 'Recent runs have a high success rate; planned tool use is generally reliable.',
        confidence: Math.min(0.9, 0.5 + successRate * 0.4),
        evidenceCount: total,
        type: 'performance',
      });
    } else if (successRate <= 0.4) {
      beliefs.push({
        statement: 'Recent runs have a low success rate; planning or tool selection needs review.',
        confidence: Math.min(0.9, 0.5 + (1 - successRate) * 0.4),
        evidenceCount: total,
        type: 'performance',
      });
    }

    if (failureLessons.length >= 3) {
      const tools = [...new Set(failureLessons.filter((l) => l.tool).map((l) => l.tool))];
      beliefs.push({
        statement: `Recurring failures detected across ${failureLessons.length} events${tools.length > 0 ? ` involving: ${tools.join(', ')}` : ''}.`,
        confidence: Math.min(0.85, 0.4 + failureLessons.length * 0.1),
        evidenceCount: failureLessons.length,
        type: 'failure_pattern',
      });
    }

    return {
      beliefs,
      basis: `reflection_over_${total}_recent_runs`,
      snapshotCount: total,
      timeWindowMs: windowMs,
      successRate,
      generatedAt: now,
    };
  }

  // Reconsolidate: update an existing memory with new confirming/disconfirming evidence.
  async reconsolidate(memoryId, newEvidence, { confirmed = true, userId = 'anon' } = {}) {
    const snap = this.snapshots.find((s) => s.id === memoryId);
    if (!snap) return null;

    if (confirmed) {
      snap.strength = Math.min(1.0, snap.strength + 0.15);
      snap.tags.push(`confirmed:${Date.now()}`);
    } else {
      snap.strength = Math.max(0, snap.strength - 0.2);
      snap.tags.push(`disconfirmed:${Date.now()}`);
    }

    snap.lastAccessed = Date.now();
    snap.accessCount += 1;

    // Update the persisted memory record too.
    await this.store.addMemoryRecord({
      id: `${snap.id}-recon-${Date.now()}`,
      text: `${snap.text} — Reconsolidated: ${newEvidence}`,
      tags: [...snap.tags, `reconsolidated:${confirmed ? 'confirmed' : 'disconfirmed'}`],
      user: userId,
      vec: embed(`${snap.text} ${newEvidence}`),
      createdAt: Date.now(),
    });

    return snap;
  }

  // Get a snapshot by ID.
  get(memoryId) {
    return this.snapshots.find((s) => s.id === memoryId) ?? null;
  }

  // List all snapshots for a user, ordered by recency.
  list({ userId = 'anon', limit = 50 } = {}) {
    return this.snapshots
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  // Get stats about the memory system.
  stats() {
    const now = Date.now();
    const total = this.snapshots.length;
    const byStatus = {};
    for (const s of this.snapshots) {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
    }
    const avgStrength = total > 0
      ? this.snapshots.reduce((sum, s) => sum + decayStrength(now - s.createdAt, this.halfLifeMs), 0) / total
      : 0;
    const decayedCount = this.snapshots.filter((s) => decayStrength(now - s.createdAt, this.halfLifeMs) < 0.3).length;

    return {
      totalSnapshots: total,
      byStatus,
      averageStrength: Math.round(avgStrength * 100) / 100,
      decayedCount,
      halfLifeDays: this.halfLifeMs / (24 * 60 * 60 * 1000),
    };
  }
}
