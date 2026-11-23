// lib/godmode.mjs — player-as-god controls (Emergent City-inspired).
//
// Each action appends a world event. The town tick lets agents react to it.
// This is the "shareable" layer: airdrops, storms, blackouts, rumors, festivals.

export const GOD_ACTIONS = ['airdrop', 'smite', 'weather', 'blackout', 'rumor', 'festival'];

export class GodMode {
  constructor(store) {
    this.store = store;
  }

  _all() {
    if (!Array.isArray(this.store.data.world)) this.store.data.world = [];
    return this.store.data.world;
  }

  act({ action, target = 'town', magnitude = 1, user = 'anon' } = {}) {
    if (!GOD_ACTIONS.includes(action)) throw new Error(`unknown god action: ${action}`);
    const event = {
      id: crypto.randomUUID(),
      type: 'world_event',
      action,
      target: String(target),
      magnitude: clamp(Number(magnitude) || 1, 1, 5),
      user,
      ts: Date.now(),
      description: describe(action, target, magnitude),
    };
    this._all().push(event);
    this.store.save?.();
    return event;
  }

  list({ limit = 50 } = {}) {
    return this._all().slice(-limit).reverse();
  }
}

function describe(action, target, magnitude) {
  const m = clamp(Number(magnitude) || 1, 1, 5);
  switch (action) {
    case 'airdrop': return `A helicopter airdrops ${m * 100} coins over ${target}.`;
    case 'smite': return `Lightning strikes ${target}. Agents scatter.`;
    case 'weather': return `A ${m > 2 ? 'violent storm' : 'light rain'} rolls over ${target}.`;
    case 'blackout': return `The power grid fails across ${target}.`;
    case 'rumor': return `A rumor spreads through ${target}: "${target} is planning something."`;
    case 'festival': return `A festival begins in ${target}. Agents gather.`;
    default: return `${action} hits ${target}.`;
  }
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }