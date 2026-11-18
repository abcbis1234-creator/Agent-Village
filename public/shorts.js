const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let currentProject = null;

function message(text, error = false) {
  $('#editor-message').textContent = text;
  $('#editor-message').classList.toggle('error', error);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}
function sceneCard(scene = {}) {
  const card = document.createElement('article');
  card.className = 'repeat-card scene-card';
  card.innerHTML = '<div class="repeat-card-head"><b>Scene</b><button type="button" class="remove-row" aria-label="Remove scene">Remove</button></div><label>What is narrated<textarea class="scene-narration" rows="2" maxlength="800" required></textarea></label><label>What appears on screen<textarea class="scene-visual" rows="2" maxlength="800" required></textarea></label><label>Duration in seconds<input class="scene-duration" type="number" min="1" max="15" step="1" required></label>';
  $('.scene-narration', card).value = scene.narration || '';
  $('.scene-visual', card).value = scene.visual || '';
  $('.scene-duration', card).value = scene.durationSeconds ?? 5;
  $('.remove-row', card).addEventListener('click', () => card.remove());
  return card;
}
function sourceCard(source = {}) {
  const card = document.createElement('article');
  card.className = 'repeat-card source-card';
  card.innerHTML = '<div class="repeat-card-head"><b>Source</b><button type="button" class="remove-row" aria-label="Remove source">Remove</button></div><label>Page or source title<input class="source-title" maxlength="160" required></label><label>URL<input class="source-url" type="url" maxlength="1000" placeholder="https://…" required></label><label>Notes<input class="source-notes" maxlength="1000" placeholder="What does this source support?"></label><label class="verify-check"><input class="source-verified" type="checkbox"> I checked this source</label>';
  $('.source-title', card).value = source.title || '';
  $('.source-url', card).value = source.url || '';
  $('.source-notes', card).value = source.notes || '';
  $('.source-verified', card).checked = source.verified === true;
  $('.remove-row', card).addEventListener('click', () => card.remove());
  return card;
}
function collectProject() {
  const scenes = $$('.scene-card').map((card) => ({
    narration: $('.scene-narration', card).value.trim(),
    visual: $('.scene-visual', card).value.trim(),
    durationSeconds: Number($('.scene-duration', card).value)
  }));
  const sources = $$('.source-card').map((card) => ({
    title: $('.source-title', card).value.trim(),
    url: $('.source-url', card).value.trim(),
    notes: $('.source-notes', card).value.trim(),
    verified: $('.source-verified', card).checked
  }));
  return {
    title: $('#title').value.trim(),
    topic: $('#topic').value.trim(),
    audience: $('#audience').value.trim() || 'General audience',
    targetSeconds: Number($('#target-seconds').value),
    script: $('#script').value.trim(),
    scenes,
    sources
  };
}
function showProject(project) {
  currentProject = project;
  $('#project-id').value = project?.id || '';
  $('#editor-title').textContent = project?.title || 'New educational short';
  $('#project-status').textContent = (project?.status || 'draft').toUpperCase();
  $('#title').value = project?.title || '';
  $('#topic').value = project?.topic || '';
  $('#audience').value = project?.audience || '';
  $('#target-seconds').value = String(project?.targetSeconds || 35);
  $('#script').value = project?.script || '';
  $('#scene-list').replaceChildren(...(project?.scenes || []).map(sceneCard));
  $('#source-list').replaceChildren(...(project?.sources || []).map(sourceCard));
  const approved = project?.status === 'approved';
  const reviewing = project?.status === 'review';
  $('#save-project').disabled = approved || reviewing;
  $('#submit-review').disabled = approved || reviewing;
  $('#approve-project').disabled = !reviewing;
  $('#reject-project').disabled = !reviewing;
  message(project ? `Updated ${new Date(project.updatedAt).toLocaleString()} · ${project.history.length} history events` : 'Save a draft before submitting it for review.');
}
async function refreshProjects(selectId = currentProject?.id) {
  const { projects } = await api('/api/shorts/projects');
  const list = $('#project-list');
  list.replaceChildren();
  if (!projects.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No projects yet. Create your first short.'; list.appendChild(empty); return; }
  projects.forEach((project) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'project-row' + (project.id === selectId ? ' selected' : '');
    const title = document.createElement('b'); title.textContent = project.title;
    const meta = document.createElement('small'); meta.textContent = `${project.status.toUpperCase()} · ${project.targetSeconds}s`;
    button.append(title, meta);
    button.addEventListener('click', () => loadProject(project.id));
    list.appendChild(button);
  });
  return projects;
}
async function loadProject(id) {
  try { const { project } = await api(`/api/shorts/projects/${encodeURIComponent(id)}`); showProject(project); await refreshProjects(id); }
  catch (error) { message(error.message, true); }
}
async function saveProject(event) {
  event?.preventDefault();
  try {
    const body = collectProject();
    const id = $('#project-id').value;
    const result = id
      ? await api(`/api/shorts/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })
      : await api('/api/shorts/projects', { method: 'POST', body: JSON.stringify(body) });
    showProject(result.project);
    await refreshProjects(result.project.id);
    message('Draft saved successfully.');
    return result.project;
  } catch (error) { message(error.message, true); throw error; }
}
async function action(name, note = '') {
  try {
    if (!$('#project-id').value) await saveProject();
    const id = $('#project-id').value;
    const { project } = await api(`/api/shorts/projects/${encodeURIComponent(id)}/${name}`, { method: 'POST', body: JSON.stringify({ note }) });
    showProject(project);
    await refreshProjects(project.id);
    message(name === 'submit' ? 'Submitted for human review.' : name === 'approve' ? 'Project approved. Rendering is not connected yet.' : 'Changes requested. Edit the draft and submit again.');
  } catch (error) { message(error.message, true); }
}
$('#project-form').addEventListener('submit', (event) => saveProject(event).catch(() => {}));
$('#new-project').addEventListener('click', () => { showProject(null); refreshProjects(null).catch(() => {}); });
$('#add-scene').addEventListener('click', () => $('#scene-list').appendChild(sceneCard()));
$('#add-source').addEventListener('click', () => $('#source-list').appendChild(sourceCard()));
$('#submit-review').addEventListener('click', () => action('submit'));
$('#approve-project').addEventListener('click', () => action('approve', 'Approved by the project owner.'));
$('#reject-project').addEventListener('click', () => action('reject', 'Changes requested by the reviewer.'));
refreshProjects().then((projects) => { if (projects?.length) loadProject(projects[0].id); else showProject(null); }).catch((error) => message(error.message, true));
