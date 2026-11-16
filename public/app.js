const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const historyKey = 'agent-village-history';
const capabilityInput = $('#capability-input');
const buildingInfo = {
  command: { title: 'Command Center', kicker: 'Village Hall / Decider', copy: 'The Decider synthesizes the council reports, keeps dissent visible, and issues the final call.', detail: 'Routing policy: bounded local run · Verification: enabled · Provider keys: server-only' },
  research: { title: 'Research Lab', kicker: 'Lyra / Research', copy: 'Lyra maps evidence gaps and labels assumptions before the village commits to a path.', detail: 'Output: evidence gaps · Risk: disconfirming questions · Status: ready' },
  forge: { title: 'Factory', kicker: 'Forge / Build', copy: 'Forge turns the decision into the smallest testable slice, with a happy path and a failure path.', detail: 'Output: implementation steps · Guardrail: no arbitrary shell execution in browser' },
  memory: { title: 'Memory Grove', kicker: 'Semantic memory / local', copy: 'The local edition keeps a small browser history so repeated missions remain inspectable.', detail: 'Storage: browser-local · Retention: last 6 missions · Clearable: yes' },
};

function setClock() { const now = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date()); document.title = `Agent Village · ${now}`; }
setClock(); setInterval(setClock, 30000);
function getHistory() { try { return JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { return []; } }
function saveHistory(result) { const list = [{ id: result.id, mission: result.mission, decision: result.verdict.decision, at: new Date().toISOString() }, ...getHistory().filter(x => x.mission !== result.mission)].slice(0, 6); localStorage.setItem(historyKey, JSON.stringify(list)); $('#history-count').textContent = list.length; }
function setRunning(isRunning) { $$('[data-agent]').forEach((agent) => agent.classList.toggle('working', isRunning)); $('#agent-live-count').textContent = isRunning ? '5' : '0'; }
async function loadCapabilities() {
  try {
    const response = await fetch('/api/capabilities');
    const payload = await response.json();
    const list = $('#capability-list');
    list.textContent = '';
    payload.capabilities.filter((item) => item.key !== 'auto').forEach((item) => {
      const row = document.createElement('div'); row.className = 'capability-chip';
      const icon = document.createElement('span'); icon.className = 'capability-icon'; icon.textContent = item.icon;
      const copy = document.createElement('div'); const name = document.createElement('strong'); name.textContent = item.name; const description = document.createElement('small'); description.textContent = item.description; copy.append(name, description); row.append(icon, copy); list.appendChild(row);
    });
  } catch { /* The core app remains useful if the registry endpoint is unavailable. */ }
}
function showBuilding(key) { const info = buildingInfo[key]; if (!info) return; $('#building-kicker').textContent = info.kicker; $('#building-title').textContent = info.title; $('#building-copy').textContent = info.copy; $('#building-details').textContent = info.detail; $('#building-dialog').showModal(); }
$$('[data-building]').forEach((button) => button.addEventListener('click', () => showBuilding(button.dataset.building)));
$$('.view-tab').forEach((button) => button.addEventListener('click', () => { $$('.view-tab').forEach((tab) => tab.classList.toggle('active', tab === button)); const town = button.dataset.view === 'town'; $('#town-view').classList.toggle('hidden', !town); $('#station-view').classList.toggle('hidden', town); $('#mode-caption').textContent = town ? 'Town view / live overview' : 'Station view / orchestration graph'; }));

function drawOutput(result) {
  const reports = $('#report-list'); reports.textContent = '';
  const latest = result.reports.filter((report) => report.round === result.rounds);
  const colors = { nova: '#bd9aff', atlas: '#7bb9ff', lyra: '#83d69b', forge: '#f8a05b', echo: '#ff9fbb' };
  latest.forEach((report) => { const row = document.createElement('article'); row.className = 'report-row'; const meta = document.createElement('div'); meta.className = 'report-meta'; meta.style.color = colors[report.role.key]; meta.textContent = report.role.name; const metaSmall = document.createElement('small'); metaSmall.textContent = `${report.role.specialty} · R${report.round}`; meta.appendChild(metaSmall); const text = document.createElement('p'); text.textContent = report.text; row.append(meta, text); reports.appendChild(row); });
  const panel = $('#decider-panel'); panel.textContent = ''; const title = document.createElement('div'); title.className = 'panel-title'; title.textContent = 'DECIDER / FINAL WORD'; const h = document.createElement('h3'); h.textContent = result.verdict.decision; const rationale = document.createElement('p'); rationale.textContent = result.verdict.rationale; const dissentLabel = document.createElement('h4'); dissentLabel.textContent = 'Dissent / watch-outs'; const dissent = document.createElement('p'); dissent.textContent = result.verdict.dissent; const nextLabel = document.createElement('h4'); nextLabel.textContent = 'Next actions'; const list = document.createElement('ul'); result.verdict.next_actions.forEach((action) => { const li = document.createElement('li'); li.textContent = action; list.appendChild(li); }); const deliverableLabel = document.createElement('h4'); deliverableLabel.textContent = `Deliverable / ${result.deliverable.title}`; const deliverable = document.createElement('div'); deliverable.className = 'deliverable-stack'; result.deliverable.sections.slice(0, 5).forEach((section) => { const item = document.createElement('p'); item.className = 'deliverable-item'; item.textContent = `${section.name}: ${section.content}`; deliverable.appendChild(item); }); panel.append(title, h, rationale, dissentLabel, dissent, nextLabel, list, deliverableLabel, deliverable);
  $('#output-title').textContent = result.mission; $('#mission-card-title').textContent = result.mission; $('#mission-card-copy').textContent = `${result.capability.name} route · ${result.capability.tools.join(' · ')}`; $('#mission-progress').style.width = '100%'; $('#mission-progress-label').textContent = '100% complete'; $('#town-title').textContent = `The village routed to ${result.capability.name}.`; $('#town-subtitle').textContent = 'Every report is labeled LOCAL DEMO and every next action is inspectable.'; $('#bubble-one').textContent = result.capability.name.toLowerCase(); $('#bubble-two').textContent = 'verifying'; $('#bubble-three').textContent = 'delivered'; $('#kpi-missions').textContent = getHistory().length; $('#kpi-reports').textContent = result.reports.length; $('#kpi-wake').textContent = 'complete'; $('#station-calls').textContent = result.reports.length + 1; $('#station-cost').textContent = '$0.00'; $('#latest-trail').textContent = ''; [`Router selected ${result.capability.name}`, 'Five bounded reports returned', 'Decider issued verdict'].forEach((step, index) => { const p = document.createElement('p'); p.className = 'policy-row'; const s = document.createElement('span'); s.textContent = `${String(index + 1).padStart(2, '0')}  ${step}`; const b = document.createElement('b'); b.textContent = 'done'; p.append(s, b); $('#latest-trail').appendChild(p); });
}

async function runMission(event) { event.preventDefault(); const mission = $('#mission-input').value.trim(); const rounds = Number($('#round-input').value); const capability = capabilityInput.value; if (!mission) return; const dialog = $('#mission-dialog'); const start = $('#run-mission'); start.disabled = true; start.textContent = 'Council running…'; setRunning(true); $('#mission-progress').style.width = '32%'; $('#town-title').textContent = 'Agents are moving through the village.'; $('#town-subtitle').textContent = 'Routing → reports → verification → Decider'; try { const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mission, rounds, capability }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Mission failed'); drawOutput(result); saveHistory(result); dialog.close(); } catch (error) { $('#mission-card-copy').textContent = error.message; $('#town-title').textContent = 'The village needs another try.'; } finally { start.disabled = false; start.innerHTML = 'Start council <b>↗</b>'; setRunning(false); } }
$('#open-mission').addEventListener('click', () => $('#mission-dialog').showModal()); $('#mission-form').addEventListener('submit', runMission); $('#open-history').addEventListener('click', () => { const items = getHistory(); if (items.length) { $('#mission-card-title').textContent = items[0].mission; $('#mission-card-copy').textContent = items[0].decision; } });
$('#kpi-missions').textContent = getHistory().length; $('#history-count').textContent = getHistory().length;
loadCapabilities();
