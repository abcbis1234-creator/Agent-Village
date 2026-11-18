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

function setClock() {
  const now = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
  document.title = `Agent Village · ${now}`;
}
setClock();
setInterval(setClock, 30000);

function getHistory() {
  try { return JSON.parse(localStorage.getItem(historyKey) || '[]'); } catch { return []; }
}

function saveHistory(result) {
  const list = [
    { id: result.id, mission: result.mission, decision: result.verdict.decision, at: new Date().toISOString() },
    ...getHistory().filter((x) => x.mission !== result.mission),
  ].slice(0, 6);
  localStorage.setItem(historyKey, JSON.stringify(list));
  const countEl = $('#history-count');
  if (countEl) countEl.textContent = list.length;
}

function setRunning(isRunning) {
  $$('[data-agent]').forEach((agent) => agent.classList.toggle('working', isRunning));
  const liveEl = $('#agent-live-count');
  if (liveEl) liveEl.textContent = isRunning ? '5' : '0';
}

function setWorkbenchStatus(status, confidence = '—') {
  const statusEl = $('#workbench-status');
  const confEl = $('#workbench-confidence');
  if (statusEl) statusEl.textContent = status;
  if (confEl) confEl.textContent = confidence;
}

function addActivity(title, detail, state = 'done') {
  const stream = $('#activity-stream');
  if (!stream) return;
  const item = document.createElement('div');
  item.className = 'activity-item';
  const dot = document.createElement('span');
  dot.className = `activity-dot ${state}`;
  const copy = document.createElement('div');
  const strong = document.createElement('b');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  copy.append(strong, small);
  item.append(dot, copy);
  stream.appendChild(item);
}

async function loadAgentContract() {
  try {
    const response = await fetch('/api/agent-contract');
    const contract = await response.json();
    const codeEl = $('#handoff-code');
    const copyBtn = $('#copy-contract');
    if (codeEl) codeEl.textContent = JSON.stringify(contract, null, 2);
    if (copyBtn) copyBtn.dataset.contract = JSON.stringify(contract);
  } catch {
    const codeEl = $('#handoff-code');
    if (codeEl) codeEl.textContent = 'Contract unavailable';
  }
}

async function loadCapabilities() {
  try {
    const response = await fetch('/api/capabilities');
    const payload = await response.json();
    const list = $('#capability-list');
    if (!list) return;
    list.textContent = '';
    (payload.capabilities || []).filter((item) => item.key !== 'auto').forEach((item) => {
      const row = document.createElement('div');
      row.className = 'capability-chip';
      const icon = document.createElement('span');
      icon.className = 'capability-icon';
      icon.textContent = item.icon;
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.name;
      const description = document.createElement('small');
      description.textContent = item.description;
      copy.append(name, description);
      row.append(icon, copy);
      list.appendChild(row);
    });
  } catch {
    /* The core app remains useful if the registry endpoint is unavailable. */
  }
}

function showBuilding(key) {
  const info = buildingInfo[key];
  if (!info) return;
  const kickerEl = $('#building-kicker');
  const titleEl = $('#building-title');
  const copyEl = $('#building-copy');
  const detailsEl = $('#building-details');
  if (kickerEl) kickerEl.textContent = info.kicker;
  if (titleEl) titleEl.textContent = info.title;
  if (copyEl) copyEl.textContent = info.copy;
  if (detailsEl) detailsEl.textContent = info.detail;
  const dialog = $('#building-dialog');
  if (dialog) dialog.showModal();
}

$$('[data-building]').forEach((button) => button.addEventListener('click', () => showBuilding(button.dataset.building)));

$$('.view-tab').forEach((button) => button.addEventListener('click', () => {
  $$('.view-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  const view = button.dataset.view;
  const town = $('#town-view');
  const station = $('#station-view');
  const workbench = $('#workbench-view');
  const caption = $('#mode-caption');
  if (town) town.classList.toggle('hidden', view !== 'town');
  if (station) station.classList.toggle('hidden', view !== 'station');
  if (workbench) workbench.classList.toggle('hidden', view !== 'workbench');
  if (caption) caption.textContent = view === 'town' ? 'Town view / live overview' : view === 'station' ? 'Station view / orchestration graph' : 'Workbench / supervised execution';
}));

function drawOutput(result) {
  const reports = $('#report-list');
  if (reports) reports.textContent = '';
  const latest = (result.reports || []).filter((report) => report.round === result.rounds);
  const colors = { nova: '#bd9aff', atlas: '#7bb9ff', lyra: '#83d69b', forge: '#f8a05b', echo: '#ff9fbb' };
  if (reports) {
    latest.forEach((report) => {
      const row = document.createElement('article');
      row.className = 'report-row';
      const meta = document.createElement('div');
      meta.className = 'report-meta';
      if (colors[report.role.key]) meta.style.color = colors[report.role.key];
      meta.textContent = report.role.name;
      const metaSmall = document.createElement('small');
      metaSmall.textContent = `${report.role.specialty} · R${report.round}`;
      meta.appendChild(metaSmall);
      const text = document.createElement('p');
      text.textContent = report.text;
      row.append(meta, text);
      reports.appendChild(row);
    });
  }

  const panel = $('#decider-panel');
  if (panel) {
    panel.textContent = '';
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = 'DECIDER / FINAL WORD';
    const h = document.createElement('h3');
    h.textContent = result.verdict && result.verdict.decision ? result.verdict.decision : 'No decision';
    const rationale = document.createElement('p');
    rationale.textContent = result.verdict && result.verdict.rationale ? result.verdict.rationale : '';
    const dissentLabel = document.createElement('h4');
    dissentLabel.textContent = 'Dissent / watch-outs';
    const dissent = document.createElement('p');
    dissent.textContent = result.verdict && result.verdict.dissent ? result.verdict.dissent : '';
    const nextLabel = document.createElement('h4');
    nextLabel.textContent = 'Next actions';
    const list = document.createElement('ul');
    (result.verdict && result.verdict.next_actions || []).forEach((action) => {
      const li = document.createElement('li');
      li.textContent = action;
      list.appendChild(li);
    });
    const deliverableLabel = document.createElement('h4');
    deliverableLabel.textContent = `Deliverable / ${result.deliverable && result.deliverable.title ? result.deliverable.title : '—'}`;
    const deliverable = document.createElement('div');
    deliverable.className = 'deliverable-stack';
    (result.deliverable && result.deliverable.sections || []).slice(0, 5).forEach((section) => {
      const item = document.createElement('p');
      item.className = 'deliverable-item';
      item.textContent = `${section.name}: ${section.content}`;
      deliverable.appendChild(item);
    });
    panel.append(title, h, rationale, dissentLabel, dissent, nextLabel, list, deliverableLabel, deliverable);
  }

  const outputTitle = $('#output-title');
  const missionCardTitle = $('#mission-card-title');
  const missionCardCopy = $('#mission-card-copy');
  const missionProgress = $('#mission-progress');
  const missionProgressLabel = $('#mission-progress-label');
  const townTitle = $('#town-title');
  const townSubtitle = $('#town-subtitle');
  const bubbleOne = $('#bubble-one');
  const bubbleTwo = $('#bubble-two');
  const bubbleThree = $('#bubble-three');
  const kpiMissions = $('#kpi-missions');
  const kpiReports = $('#kpi-reports');
  const kpiWake = $('#kpi-wake');
  const stationCalls = $('#station-calls');
  const stationCost = $('#station-cost');
  const latestTrail = $('#latest-trail');

  if (outputTitle) outputTitle.textContent = result.mission;
  if (missionCardTitle) missionCardTitle.textContent = result.mission;
  if (missionCardCopy) missionCardCopy.textContent = `${result.capability && result.capability.name ? result.capability.name : '—'} route · ${(result.capability && result.capability.tools || []).join(' · ')}`;
  if (missionProgress) missionProgress.style.width = '100%';
  if (missionProgressLabel) missionProgressLabel.textContent = '100% complete';
  if (townTitle) townTitle.textContent = `The village routed to ${result.capability && result.capability.name ? result.capability.name : '—'}.`;
  if (townSubtitle) townSubtitle.textContent = 'Every report is labeled MANAGED LOCAL DEMO and every next action is inspectable.';
  if (bubbleOne) bubbleOne.textContent = (result.capability && result.capability.name ? result.capability.name : '—').toLowerCase();
  if (bubbleTwo) bubbleTwo.textContent = 'verifying';
  if (bubbleThree) bubbleThree.textContent = 'delivered';
  if (kpiMissions) kpiMissions.textContent = getHistory().length;
  if (kpiReports) kpiReports.textContent = result.reports ? result.reports.length : 0;
  if (kpiWake) kpiWake.textContent = 'complete';
  if (stationCalls) stationCalls.textContent = (result.reports ? result.reports.length : 0) + 1;
  if (stationCost) stationCost.textContent = '$0.00';
  if (latestTrail) {
    latestTrail.textContent = '';
    ['Router selected ' + (result.capability && result.capability.name || '—'), 'Five bounded reports returned', 'Decider issued verdict'].forEach((step, index) => {
      const p = document.createElement('p');
      p.className = 'policy-row';
      const s = document.createElement('span');
      s.textContent = `${String(index + 1).padStart(2, '0')}  ${step}`;
      const b = document.createElement('b');
      b.textContent = 'done';
      p.append(s, b);
      latestTrail.appendChild(p);
    });
  }
  setWorkbenchStatus('REVIEW', (result.verdict && result.verdict.confidence ? result.verdict.confidence : '—').toUpperCase());
  const activityStream = $('#activity-stream');
  if (activityStream) activityStream.textContent = '';
  addActivity('Request accepted', 'Mission context bounded at the server edge.');
  addActivity('Routed to ' + (result.capability && result.capability.name || '—'), (result.capability && result.capability.tools || []).join(' · '));
  addActivity('Council reports returned', (result.reports ? result.reports.length : 0) + ' labeled reports available.');
  addActivity('Decider ready for review', 'Approve, pause, or hand off the contract.', 'active');
}

async function runMission(event) {
  event.preventDefault();
  const missionInput = $('#mission-input');
  const mission = missionInput ? missionInput.value.trim() : '';
  const roundsInput = $('#round-input');
  const rounds = roundsInput ? Number(roundsInput.value) : 2;
  const capability = capabilityInput ? capabilityInput.value : 'auto';
  if (!mission) {
    if (missionInput) missionInput.focus();
    return;
  }

  const dialog = $('#mission-dialog');
  const start = $('#run-mission');
  if (start) {
    start.disabled = true;
    start.textContent = 'Council running…';
  }
  setRunning(true);
  setWorkbenchStatus('RUNNING', '—');
  const activityStream = $('#activity-stream');
  if (activityStream) activityStream.textContent = '';
  addActivity('Request accepted', 'Building a bounded plan…', 'active');
  const missionProgress = $('#mission-progress');
  if (missionProgress) missionProgress.style.width = '32%';
  const townTitle = $('#town-title');
  const townSubtitle = $('#town-subtitle');
  if (townTitle) townTitle.textContent = 'Agents are moving through the village.';
  if (townSubtitle) townSubtitle.textContent = 'Routing → reports → verification → Decider';

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission, rounds, capability }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Mission failed');
    drawOutput(result);
    saveHistory(result);
    if (dialog) dialog.close();
  } catch (error) {
    setWorkbenchStatus('BLOCKED', 'LOW');
    addActivity('Run blocked', error.message, 'error');
    const missionCardCopy = $('#mission-card-copy');
    if (missionCardCopy) missionCardCopy.textContent = error.message;
    const townTitle = $('#town-title');
    if (townTitle) townTitle.textContent = 'The village needs another try.';
  } finally {
    if (start) {
      start.disabled = false;
      start.innerHTML = 'Start council <b>↗</b>';
    }
    setRunning(false);
  }
}

$('#open-mission').addEventListener('click', () => { const d = $('#mission-dialog'); if (d) d.showModal(); });
$('#mission-form').addEventListener('submit', runMission);
$('#open-history').addEventListener('click', () => {
  const items = getHistory();
  if (items.length) {
    const title = $('#mission-card-title');
    const copy = $('#mission-card-copy');
    if (title) title.textContent = items[0].mission;
    if (copy) copy.textContent = items[0].decision;
  }
});

$('#kpi-missions').textContent = getHistory().length;
$('#history-count').textContent = getHistory().length;

$('#approve-plan').addEventListener('click', () => {
  setWorkbenchStatus('APPROVED', 'HIGH');
  addActivity('Plan approved', 'The next connector may execute only within the reviewed scope.', 'active');
});
$('#pause-run').addEventListener('click', () => {
  setWorkbenchStatus('PAUSED', '—');
  addActivity('Run paused', 'No external action will continue until resumed.', 'error');
});

$('#copy-contract').addEventListener('click', async () => {
  try {
    const text = $('#copy-contract').dataset.contract || $('#handoff-code').textContent;
    await navigator.clipboard.writeText(text);
    $('#copy-contract').textContent = 'Copied';
    setTimeout(() => { $('#copy-contract').textContent = 'Copy contract'; }, 1500);
  } catch {
    $('#copy-contract').textContent = 'Select and copy';
  }
});

loadCapabilities();
loadAgentContract();
