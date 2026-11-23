// lib/chronicle.mjs — the town newspaper (Emergent City-inspired).
//
// Renders a Markdown chronicle from world events, runs, and wants. This is the
// single best "story" artifact to share: one paragraph a human can read.

import { AGENTS } from './agents.mjs';

export class Chronicle {
  constructor(store) {
    this.store = store;
  }

  build({ user = null, limit = 100 } = {}) {
    const world = (this.store.data.world ?? []).slice(-limit);
    const runs = Object.values(this.store.data.runs ?? {}).filter((r) => !user || r.user === user);
    const wants = (this.store.data.wants ?? []).filter((w) => !user || w.user === user);

    const lines = [];
    lines.push('# Agent Village Chronicle');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Town stats');
    lines.push(`- Agents: ${Object.keys(AGENTS).length}`);
    lines.push(`- Runs: ${runs.length}`);
    lines.push(`- Wants: ${wants.filter((w) => w.status === 'open').length} open, ${wants.filter((w) => w.status === 'claimed').length} claimed, ${wants.filter((w) => w.status === 'fulfilled').length} fulfilled`);
    lines.push(`- World events: ${world.length}`);
    lines.push('');
    lines.push('## Recent world events');
    if (world.length === 0) lines.push('_Nothing has happened yet._');
    else for (const e of world.slice(-20).reverse()) lines.push(`- ${new Date(e.ts).toISOString()} — ${e.description}`);
    lines.push('');
    lines.push('## Recent runs');
    if (runs.length === 0) lines.push('_No runs yet._');
    else for (const r of runs.slice(-10).reverse()) {
      lines.push(`- ${new Date(r.createdAt).toISOString()} — ${r.status}${r.error ? ` (${r.error})` : ''}`);
    }
    return lines.join('\n');
  }
}