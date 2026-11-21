const state = { agents: {}, conversations: [], conversationId: null, streaming: false, buffer: '', streamEl: null };
const $ = (id) => document.getElementById(id);
const els = {
  conversations: $('conversations'), agents: $('agents'), transcript: $('transcript'),
  composer: $('composer'), input: $('message'), status: $('status'),
  title: $('conv-title'), phase: $('phase'), newBtn: $('new-conv'),
  palette: $('palette'), paletteInput: $('palette-input'), paletteList: $('palette-list'),
};
const setStatus = (t) => (els.status.textContent = t ?? '');

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
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
    btn.addEventListener('click', () => openConversation(c.id));
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

async function loadAgents() { const { agents } = await api('/api/agents'); state.agents = Object.fromEntries(agents.map((a) => [a.id, a])); renderAgents(); }
async function loadConversations() { const { conversations } = await api('/api/conversations'); state.conversations = conversations; renderConversations(); }

async function newConversation() {
  const c = await api('/api/conversations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'planner' }) });
  state.conversations.unshift(c); renderConversations(); await openConversation(c.id);
}

async function openConversation(id) {
  state.conversationId = id;
  const c = await api(`/api/conversations/${id}`);
  els.title.textContent = c.title;
  els.transcript.replaceChildren();
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
  els.transcript.append(bubble({ role: 'user', content: message })); scrollBottom();

  try {
    const res = await fetch(`/api/conversations/${state.conversationId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error ?? `HTTP ${res.status}`); }

    for await (const { event, data } of sseStream(res)) {
      if (event === 'phase') { els.phase.hidden = false; els.phase.textContent = `phase · ${data.phase}`; els.phase.style.color = state.agents[data.agentId]?.color ?? ''; }
      else if (event === 'memory_packet') {
        if (data.packet.length) els.transcript.append(chip({ icon: '📚', label: `recalled ${data.packet.length} memories`, detail: data.packet.map((p) => p.text).join(' · ') }));
        scrollBottom();
      }
      else if (event === 'scout_report') {
        els.transcript.append(chip({ icon: '🔍', label: 'scout', detail: `intent: ${data.intent}, domain: ${data.domain}${data.ambiguities?.length ? `, ambiguities: ${data.ambiguities.join(', ')}` : ''}` }));
        scrollBottom();
      }
      else if (event === 'planner_raw') {
        els.transcript.append(chip({ icon: '🧭', label: `plan: ${data.steps.length} step${data.steps.length === 1 ? '' : 's'}`, detail: data.steps.map((s) => `${s.tool}(${JSON.stringify(s.args ?? {})})`).join(' · ') || 'no tools' }));
        scrollBottom();
      }
      else if (event === 'security_decision') {
        const v = data.decision.verdict;
        const icon = v === 'deny' ? '⛔' : v === 'require_approval' ? '🔐' : '✅';
        els.transcript.append(chip({ icon, label: `security ${v}`, detail: `${data.decision.tool}: ${(data.decision.reasons ?? []).join('; ') || 'ok'}` }));
        scrollBottom();
      }
      else if (event === 'tool_result') { els.transcript.append(chip({ icon: '⚙', label: data.tool, detail: String(data.result).slice(0, 200) })); scrollBottom(); }
      else if (event === 'tool_error') { els.transcript.append(chip({ icon: '✗', label: `${data.tool} failed`, detail: data.error })); scrollBottom(); }
      else if (event === 'verification') {
        if (data.findings?.length) els.transcript.append(chip({ icon: '🛡️', label: `verifier: ${data.severity}`, detail: data.findings.map((f) => f.kind).join(', ') }));
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
        els.transcript.append(chip({ icon: v.overall === 'reject' ? '⚖️' : '✓', label: `critic: ${v.overall} (${v.calibrated})`, detail: v.findings.map((f) => f.finding ?? (f.gaps?.join(', ')) ?? f.counterCase).filter(Boolean).join(' · ') || 'no findings' }));
        scrollBottom();
      }
      else if (event === 'budget') { els.transcript.append(chip({ icon: '💾', label: 'budget', detail: `tokens: ${data.snapshot.used.tokens}, tools: ${data.snapshot.used.toolCalls}, ${data.snapshot.elapsedMs}ms` })); }
      else if (event === 'error') { els.transcript.append(bubble({ role: 'agent', agentId: 'system', content: `Error (${data.where ?? 'run'}): ${data.message}` })); }
    }
  } catch (err) {
    els.transcript.append(bubble({ role: 'agent', agentId: 'system', content: `Error: ${err.message}` }));
  } finally {
    state.streaming = false; els.phase.hidden = true; scrollBottom();
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
    btn.addEventListener('click', () => { closePalette(); openConversation(c.id); });
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
els.paletteInput.addEventListener('input', (e) => renderPaletteList(e.target.value));
els.palette.addEventListener('click', (e) => { if (e.target === els.palette) closePalette(); });
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  if (e.key === 'Escape') closePalette();
});

(async function boot() {
  try {
    await loadAgents(); await loadConversations();
    if (state.conversations.length > 0) await openConversation(state.conversations[0].id);
    else await newConversation();
  } catch (err) { setStatus(`Boot failed: ${err.message}`); }
})();