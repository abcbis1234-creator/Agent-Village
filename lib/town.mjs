// lib/town.mjs — the simulation tick (OpenWants + Emergent City-inspired).
//
// A tick is deterministic: agents notice open wants and claim strong matches.
// No LLM calls — cheap enough to run on a timer or from the UI.

import { AGENTS } from './agents.mjs';
import { persist } from './persist.mjs';

const AGENT_KEYWORDS = {
  scout: ['find', 'search', 'research', 'look', 'map'],
  planner: ['plan', 'organize', 'schedule', 'coordinate'],
  builder: ['build', 'make', 'create', 'fix', 'repair'],
  verifier: ['check', 'verify', 'test', 'validate'],
  synthesizer: ['summarize', 'merge', 'combine', 'brief'],
  reviewer: ['review', 'answer', 'write', 'explain'],
  critic: ['critique', 'challenge', 'audit', 'judge'],
  archivist: ['remember', 'record', 'store', 'archive'],
  securityReviewer: ['secure', 'guard', 'protect', 'lock'],
};

export class Town {
  constructor(store) {
    this.store = store;
    this.tickCount = 0;
  }

  tick({ user = 'anon' } = {}) {
    this.tickCount += 1;
    if (!Array.isArray(this.store.data.world)) this.store.data.world = [];
    const wants = (this.store.data.wants ?? []).filter((w) => w.status === 'open');
    const events = [];

    for (const w of wants) {
      const agent = matchAgent(w);
      const event = {
        id: crypto.randomUUID(),
        type: 'world_event',
        action: 'notice',
        target: agent,
        wantId: w.id,
        description: `${AGENTS[agent]?.name ?? agent} noticed a want: "${w.text.slice(0, 80)}"`,
        ts: Date.now(),
        tick: this.tickCount,
      };
      this.store.data.world.push(event);
      events.push(event);

      if (strongMatch(w, agent)) {
        w.status = 'claimed';
        w.claimedBy = agent;
        w.updatedAt = Date.now();
      }
    }

    persist(this.store);
    return { tick: this.tickCount, events, openWants: wants.length };
  }

  stats() {
    const wants = this.store.data.wants ?? [];
    const world = this.store.data.world ?? [];
    const runs = this.store.data.runs ?? {};
    return {
      tick: this.tickCount,
      agents: Object.keys(AGENTS).length,
      wants: {
        total: wants.length,
        open: wants.filter((w) => w.status === 'open').length,
        claimed: wants.filter((w) => w.status === 'claimed').length,
        fulfilled: wants.filter((w) => w.status === 'fulfilled').length,
      },
      worldEvents: world.length,
      runs: Object.keys(runs).length,
      memories: (this.store.data.memories ?? []).length,
    };
  }
}

function matchAgent(want) {
  const text = `${want.text} ${(want.tags ?? []).join(' ')}`.toLowerCase();
  let best = 'reviewer';
  let bestScore = 0;
  for (const [agent, kws] of Object.entries(AGENT_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) if (text.includes(kw)) score += 1;
    if (score > bestScore) { best = agent; bestScore = score; }
  }
  return best;
}

function strongMatch(want, agent) {
  const text = `${want.text} ${(want.tags ?? []).join(' ')}`.toLowerCase();
  return (AGENT_KEYWORDS[agent] ?? []).some((kw) => text.includes(kw));
}