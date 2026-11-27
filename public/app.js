const state = { agents: {}, conversations: [], conversationId: null, streaming: false, buffer: '', streamEl: null };
const $ = (id) => document.getElementById(id);
const els = {
  conversations: $('conversations'), agents: $('agents'), transcript: $('transcript'),
  composer: $('composer'), input: $('message'), status: $('status'),
  title: $('conv-title'), phase: $('phase'), newBtn: $('new-conv'),
  palette: $('palette'), paletteInput: $('palette-input'), paletteList: $('palette-list'),
  townStats: $('town-stats'), godButtons: $('god-buttons'), tick: $('tick'),
  wantForm: $('want-form'), wantInput: $('want-input'), wants: $('wants'),
  timeline: $('timeline-list'), timelineCount: $('timeline-count'),
  budget: $('budget'), budgetLabel: $('budget-label'), budgetFill: $('budget-fill'),
};
const setStatus = (t) => (els.status.textContent = t ?? '');

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

function renderAgents() {
  els.agents.replaceChildren();
  for (const a of Object.values(state.agents)) {
    const li = document.createElement('li');
    li.className = 'agent';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = a.color;
    const label = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = `${a.emoji} ${a.name}`;
    const role = document.createElement('span'); role.className = 'role'; role.textContent = a.role;
    label.append(name, role); li.append(dot, label); els.agents.append(li);
  }
}

function renderConversations() {
  els.conversations.replaceChildren();
  for (const c of state.conversations) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'conv-btn' + (c.id === state.conversationId ? ' active' : '');
    btn.textContent = c.title;
    btn.addEventListener('click', () => openConversation(c.id).catch((e) => setStatus(e.message)));
    li.append(btn); els.conversations.append(li);
  }
}

function bubble({ role, agentId, content, kind }) {
  const wrap = document.createElement('div');
  wrap.className = `bubble ${role}${kind ? ' ' + kind : ''}`;
  const who = document.createElement('div'); who.className = 'who';
  if (role === 'user') who.textContent = 'you';
  else if (agentId === 'system') who.textContent = 'system';
  else { const a = state.agents[agentId]; who.textContent = a ? `${a.emoji} ${a.name}` : agentId ?? 'agent'; if (a) who.style.color = a.color; }
  const body = document.createElement('div'); body.className = 'body'; body.textContent = content;
  wrap.append(who, body);
  return wrap;
}

function chip({ icon, label, detail }) {
  const el = document.createElement('div');
  el.className = 'chip';
  const l = document.createElement('span'); l.className = 'label'; l.textContent = `${icon} ${label}`;
  const d = document.createElement('span'); d.className = 'detail'; d.textContent = detail ?? '';
  el.append(l, d);
  return el;
}

function scrollBottom() { els.transcript.scrollTop = els.transcript.scrollHeight; }

/* ---------- run timeline (OBS-060) ---------- */

function clearTimeline() {
  if (!els.timeline) return;
  els.timeline.replaceChildren();
  if (els.timelineCount) els.timelineCount.textContent = '0';
}

function addTimeline(kind, label, detail) {
  if (!els.timeline) return;
  const li = document.createElement('li');
  li.className = 'tl-item' + (kind ? ` ${kind}` : '');
  const dot = document.createElement('span'); dot.className = 'tl-dot';
  const body = document.createElement('div');
  const l = document.createElement('span'); l.className = 'tl-label'; l.textContent = label;
  const t = document.createElement('span'); t.className = 'tl-time'; t.textContent = new Date().toLocaleTimeString([], { hour12: false });
  body.append(l);
  if (detail) {
    const d = document.createElement('span'); d.className = 'tl-detail'; d.textContent = String(detail); body.append(d);
  }
  body.append(t);
  li.append(dot, body);
  els.timeline.append(li);
  while (els.timeline.children.length > 200) els.timeline.firstElementChild.remove();
  if (els.timelineCount) els.timelineCount.textContent = String(els.timeline.children.length);
  const rail = els.timeline.parentElement;
  if (rail) rail.scrollTop = rail.scrollHeight;
}

/* ---------- live budget meter (UX-069) ---------- */

function resetBudget() {
  if (!els.budget) return;
  els.budget.hidden = true;
  els.budget.classList.remove('warn', 'over');
  if (els.budgetFill) els.budgetFill.style.width = '0%';
  if (els.budgetLabel) els.budgetLabel.textContent = 'budget';
}

function updateBudget(snapshot) {
  if (!els.budget || !snapshot) return;
  const caps = snapshot.caps ?? {};
  const used = snapshot.used ?? {};
  const tokenCap = Number(caps.tokens) || 0;
  const tokenUsed = Number(used.tokens) || 0;
  const costCap = Number(caps.cost) || 0;
  const costUsed = Number(used.cost) || 0;
  const ratios = [];
  if (tokenCap > 0) ratios.push(tokenUsed / tokenCap);
  if (costCap > 0) ratios.push(costUsed / costCap);
  const worst = ratios.length ? Math.max(...ratios) : 0;

  els.budget.hidden = false;
  els.budgetLabel.textContent = `${tokenUsed}/${tokenCap} tokens · $${costUsed.toFixed(2)}/$${costCap.toFixed(2)} · ${Math.max(0, tokenCap - tokenUsed)} tokens left`;
  els.budgetFill.style.width = `${Math.min(100, Math.max(0, worst * 100)).toFixed(1)}%`;
  els.budget.classList.toggle('warn', worst >= 0.8 && worst < 1);
  els.budget.classList.toggle('over', worst >= 1);
}

async function loadAgents() { const { agents } = await api('/api/agents'); state.agents = Object.fromEntries(agents.map((a) => [a.id, a])); renderAgents(); }
async function loadConversations() { const { conversations } = await api('/api/conversations'); state.conversations = conversations; renderConversations(); }

/* ---------- town ---------- */

async function loadTown() {
  try {
    const [stats, wants] = await Promise.all([
      api('/api/town/stats'),
      api('/api/wants?status=open'),
    ]);
    if (els.townStats) {
      els.townStats.textContent = `${stats.agents} agents · ${stats.wants.open} open wants · ${stats.worldEvents} events · ${stats.runs} runs`;
    }
    renderWants(wants.wants ?? []);
  } catch { /* the town panel is optional */ }
}

function renderWants(wants) {
  if (!els.wants) return;
  els.wants.replaceChildren();
  if (!wants.length) {
    const li = document.createElement('li');
    li.className = 'want-empty';
    li.textContent = 'No open wants.';
    els.wants.append(li);
    return;
  }
  for (const w of wants) {
    const li = document.createElement('li');
    li.className = 'want';
    const text = document.createElement('span');
    text.className = 'want-text';
    text.textContent = w.text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'want-btn';
    btn.textContent = w.status === 'open' ? 'Claim' : w.status === 'claimed' ? 'Fulfill' : w.status;
    btn.addEventListener('click', async () => {
      try {
        if (w.status === 'open') {
          await api(`/api/wants/${w.id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        } else if (w.status === 'claimed') {
          await api(`/api/wants/${w.id}/fulfill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result: 'done' }) });
        }
        await loadTown();
      } catch (e) { setStatus(e.message); }
    });
    li.append(text, btn);
    els.wants.append(li);
  }
}

async function godMode(action) {
  try {
    await api('/api/godmode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, magnitude: 2 }) });
    await loadTown();
  } catch (e) { setStatus(e.message); }
}

async function postWant(text) {
  try {
    await api('/api/wants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    await loadTown();
  } catch (e) { setStatus(e.message); }
}

async function tick() {
  try {
    const r = await api('/api/town/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setStatus(`tick ${r.tick}: ${r.events.length} notices`);
    await loadTown();
  } catch (e) { setStatus(e.message); }
}

async function newConversation() {
  if (state.streaming) { setStatus('Wait for the current run to finish.'); return; }
  const c = await api('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'planner' }) });
  state.conversations.unshift(c); renderConversations(); await openConversation(c.id);
}

async function openConversation(id) {
  // Switching mid-stream would append the active run's events to a different
  // transcript, so keep the user on the conversation that is streaming.
  if (state.streaming && id !== state.conversationId) { setStatus('Wait for the current run to finish.'); return; }
  state.conversationId = id;
  const c = await api(`/api/conversations/${id}`);
  els.title.textContent = c.title;
  els.transcript.replaceChildren();
  clearTimeline(); resetBudget();
  for (const m of c.messages) els.transcript.append(bubble(m));
  renderConversations(); scrollBottom();
}

async function* sseStream(response) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let event = 'message'; const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
      }
      if (data.length) { try { yield { event, data: JSON.parse(data.join('\n')) }; } catch { yield { event, data: data.join('\n') }; } }
    }
  }
}

async function sendMessage(message) {
  if (state.streaming) return;
  state.streaming = true;
  clearTimeline(); resetBudget();
  addTimeline('', 'Run started', message.slice(0, 120));
  els.transcript.append(bubble({ role: 'user', content: message })); scrollBottom();

  try {
    const res = await fetch(`/api/conversations/${state.conversationId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error ?? `HTTP ${res.status}`); }

    for await (const { event, data } of sseStream(res)) {
      if (event === 'phase') {
        els.phase.hidden = false; els.phase.textContent = `phase · ${data.phase}`; els.phase.style.color = state.agents[data.agentId]?.color ?? '';
        addTimeline('', `Phase ${data.phase}`, data.agentId ?? '');
      }
      else if (event === 'heartbeat') { /* liveness only */ }
      else if (event === 'memory_packet') {
        if (data.packet.length) {
          els.transcript.append(chip({ icon: '📚', label: `recalled ${data.packet.length} memories`, detail: data.packet.map((p) => p.text).join(' · ') }));
          addTimeline('', `Recalled ${data.packet.length} memories`, data.packet.map((p) => p.text).join(' · ').slice(0, 140));
        }
        scrollBottom();
      }
      else if (event === 'scout_report') {
        els.transcript.append(chip({ icon: '🔍', label: 'scout', detail: `intent: ${data.intent}, domain: ${data.domain}${data.ambiguities?.length ? `, ambiguities: ${data.ambiguities.join(', ')}` : ''}` }));
        addTimeline('', 'Scout report', `${data.intent} · ${data.domain}`);
        scrollBottom();
      }
      else if (event === 'planner_raw') {
        els.transcript.append(chip({ icon: '🧭', label: `plan: ${data.steps.length} step${data.steps.length === 1 ? '' : 's'}`, detail: data.steps.map((s) => `${s.tool}(${JSON.stringify(s.args ?? {})})`).join(' · ') || 'no tools' }));
        addTimeline('', `Plan · ${data.steps.length} step${data.steps.length === 1 ? '' : 's'}`, data.steps.map((s) => s.tool).join(' · ') || 'no tools');
        scrollBottom();
      }
      else if (event === 'checkpoint') {
        addTimeline('ok', `Checkpoint · ${data.phase}`, 'saved');
      }
      else if (event === 'security_decision') {
        const v = data.decision.verdict;
        const icon = v === 'deny' ? '⛔' : v === 'require_approval' ? '🔐' : '✅';
        els.transcript.append(chip({ icon, label: `security ${v}`, detail: `${data.decision.tool}: ${(data.decision.reasons ?? []).join('; ') || 'ok'}` }));
        addTimeline(v === 'deny' ? 'error' : v === 'require_approval' ? 'warn' : 'ok', `Security ${v}`, `${data.decision.tool}: ${(data.decision.reasons ?? []).join('; ') || 'ok'}`);
        scrollBottom();
      }
      else if (event === 'tool_result') {
        els.transcript.append(chip({ icon: '⚙', label: data.tool, detail: String(data.result).slice(0, 200) }));
        addTimeline('ok', `Tool ${data.tool}`, String(data.result).slice(0, 120));
        scrollBottom();
      }
      else if (event === 'tool_error') {
        els.transcript.append(chip({ icon: '✗', label: `${data.tool} failed`, detail: data.error }));
        addTimeline('error', `Tool ${data.tool} failed`, `${data.error}${data.failure ? ` (${data.failure.code})` : ''}`);
        scrollBottom();
      }
      else if (event === 'verification') {
        if (data.findings?.length) els.transcript.append(chip({ icon: '🛡️', label: `verifier: ${data.severity}`, detail: data.findings.map((f) => f.kind).join(', ') }));
        addTimeline(data.findings?.length ? 'warn' : 'ok', `Verification · ${data.severity}`, (data.findings ?? []).map((f) => f.kind).join(', '));
        scrollBottom();
      }
      else if (event === 'message_start') {
        state.streamEl = bubble({ role: 'agent', agentId: data.agentId, content: '' });
        state.streamEl.classList.add('streaming'); state.buffer = '';
        els.transcript.append(state.streamEl); scrollBottom();
      }
      else if (event === 'chunk') {
        state.buffer += data.content;
        const body = state.streamEl?.querySelector('.body'); if (body) body.textContent = state.buffer;
        scrollBottom();
      }
      else if (event === 'message_end') { state.streamEl?.classList.remove('streaming'); state.streamEl = null; }
      else if (event === 'critique') {
        const v = data.verdict;
        els.transcript.append(chip({ icon: v.overall === 'reject' ? '⚖️' : '✓', label: `critic: ${v.overall} (${v.calibrated})`, detail: (v.findings ?? []).map((f) => f.finding ?? (f.gaps?.join(', ')) ?? f.counterCase).filter(Boolean).join(' · ') || 'no findings' }));
        addTimeline(v.overall === 'reject' ? 'warn' : 'ok', `Critic ${v.overall}`, `${v.calibrated} confidence`);
        scrollBottom();
      }
      else if (event === 'revision_requested') {
        els.transcript.append(chip({ icon: '🔁', label: 'critic requested a revision', detail: (data.findings ?? []).map((f) => f.finding ?? f.gaps?.join(', ') ?? f.counterCase).filter(Boolean).join(' · ') || data.summary || '' }));
        addTimeline('warn', 'Revision requested', data.summary ?? '');
        scrollBottom();
      }
      else if (event === 'archive_written') {
        els.transcript.append(chip({ icon: '🗂️', label: 'memory saved', detail: `id ${String(data.memoryId ?? '').slice(0, 8)}` }));
        addTimeline('ok', 'Memory archived', (data.lessons ?? []).join(' · '));
        scrollBottom();
      }
      else if (event === 'tool_denied') {
        els.transcript.append(chip({ icon: '⛔', label: `${data.tool} denied`, detail: (data.reasons ?? []).join('; ') }));
        addTimeline('error', `Tool ${data.tool} denied`, (data.reasons ?? []).join('; '));
        scrollBottom();
      }
      else if (event === 'phase_resumed') {
        addTimeline('ok', `Resumed ${data.phase}`, 'from checkpoint');
      }
      else if (event === 'suspended') {
        addTimeline('warn', `Suspended at ${data.phase}`, 'resume to continue');
        setStatus('Run suspended. Resume to continue.');
      }
      else if (event === 'cancelled') {
        addTimeline('warn', 'Run cancelled', 'the client or an operator stopped it');
      }
      else if (event === 'interrupted') {
        addTimeline('error', 'Run interrupted', 'the server restarted before it finished');
      }
      else if (event === 'phase_gate_failed') {
        addTimeline('error', `Gate failed · ${data.phase}`, (data.reasons ?? []).join('; '));
      }
      else if (event === 'budget') {
        updateBudget(data.snapshot);
        els.transcript.append(chip({ icon: '💾', label: 'budget', detail: `tokens: ${data.snapshot.used.tokens}, tools: ${data.snapshot.used.toolCalls}, ${data.snapshot.elapsedMs}ms` }));
      }
      else if (event === 'done') {
        addTimeline('ok', 'Run complete', '');
      }
      else if (event === 'error') {
        els.transcript.append(bubble({ role: 'agent', agentId: 'system', content: `Error (${data.where ?? 'run'}): ${data.message}${data.failure ? ` [${data.failure.code}]` : ''}` }));
        addTimeline('error', `Error · ${data.where ?? 'run'}`, `${data.message}${data.failure ? ` (${data.failure.code})` : ''}`);
      }
    }
  } catch (err) {
    els.transcript.append(bubble({ role: 'agent', agentId: 'system', content: `Error: ${err.message}` }));
  } finally {
    state.streaming = false; state.streamEl = null; state.buffer = '';
    els.phase.hidden = true; scrollBottom();
    loadConversations().catch(() => {});
  }
}

function openPalette() { els.palette.hidden = false; els.paletteInput.value = ''; renderPaletteList(''); els.paletteInput.focus(); }
function closePalette() { els.palette.hidden = true; }
function renderPaletteList(q) {
  const query = q.toLowerCase();
  els.paletteList.replaceChildren();
  for (const c of state.conversations.filter((c) => c.title.toLowerCase().includes(query))) {
    const li = document.createElement('li');
    const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = c.title;
    btn.addEventListener('click', () => { closePalette(); openConversation(c.id).catch((e) => setStatus(e.message)); });
    li.append(btn); els.paletteList.append(li);
  }
}

els.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.conversationId) { setStatus('Create a conversation first.'); return; }
  const message = els.input.value.trim();
  if (!message) return;
  els.input.value = ''; setStatus(''); sendMessage(message);
});
els.newBtn.addEventListener('click', () => newConversation().catch((e) => setStatus(e.message)));
els.godButtons?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (btn) godMode(btn.dataset.action);
});
els.tick?.addEventListener('click', tick);
els.wantForm?.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.wantInput.value.trim();
  if (!text) return;
  els.wantInput.value = '';
  postWant(text);
});
els.paletteInput.addEventListener('input', (e) => renderPaletteList(e.target.value));
els.palette.addEventListener('click', (e) => { if (e.target === els.palette) closePalette(); });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'Escape') closePalette();
});

(async function boot() {
  try {
    await loadAgents(); await loadConversations(); await loadTown();
    if (state.conversations.length > 0) await openConversation(state.conversations[0].id);
    else await newConversation();
  } catch (err) { setStatus(`Boot failed: ${err.message}`); }
})();