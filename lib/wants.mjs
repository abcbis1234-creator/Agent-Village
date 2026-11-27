// lib/wants.mjs — the shared "wants" board (OpenWants-inspired).
//
// Every agent (or citizen) can publish what it needs; others claim and fulfill it.
// This is the city's shared data source: a simple, append-oriented market where
// agents find each other through one list instead of point-to-point plumbing.

import { persist } from './persist.mjs';

export class WantBoard {
  constructor(store) {
    this.store = store;
  }

  _all() {
    if (!Array.isArray(this.store.data.wants)) this.store.data.wants = [];
    return this.store.data.wants;
  }

  post({ text, author = 'citizen', tags = [], reward = 0, user = 'anon' } = {}) {
    const clean = String(text ?? '').trim();
    if (!clean) throw new Error('text is required');
    const want = {
      id: crypto.randomUUID(),
      text: clean,
      author,
      tags: Array.isArray(tags) ? tags : [],
      reward: Number(reward) || 0,
      user,
      status: 'open',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      claimedBy: null,
      fulfilledBy: null,
      result: null,
    };
    this._all().push(want);
    persist(this.store);
    return want;
  }

  list({ status = 'open', user = null } = {}) {
    return this._all()
      .filter((w) => (status ? w.status === status : true))
      .filter((w) => (user ? w.user === user : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id) {
    return this._all().find((w) => w.id === id) ?? null;
  }

  claim(id, { by = 'citizen' } = {}) {
    const w = this.get(id);
    if (!w) throw new Error('want not found');
    if (w.status !== 'open') throw new Error(`want is ${w.status}`);
    w.status = 'claimed';
    w.claimedBy = by;
    w.updatedAt = Date.now();
    persist(this.store);
    return w;
  }

  fulfill(id, { by = 'citizen', result = '' } = {}) {
    const w = this.get(id);
    if (!w) throw new Error('want not found');
    if (w.status !== 'claimed') throw new Error(`want must be claimed first (is ${w.status})`);
    w.status = 'fulfilled';
    w.fulfilledBy = by;
    w.result = String(result);
    w.updatedAt = Date.now();
    persist(this.store);
    return w;
  }

  cancel(id, { user = 'anon' } = {}) {
    const w = this.get(id);
    if (!w) throw new Error('want not found');
    if (w.user !== user) throw new Error('not your want');
    w.status = 'cancelled';
    w.updatedAt = Date.now();
    persist(this.store);
    return w;
  }

  stats() {
    const all = this._all();
    const byStatus = {};
    for (const w of all) byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;
    return { total: all.length, byStatus };
  }
}