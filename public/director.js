// Director workbench — talks only to /api/director/*, renders with DOM nodes.
const state = { plan: null, dirty: false, busy: false };

const $ = (id) => document.getElementById(id);
const els = {
  form: $('plan-form'), brief: $('brief'), platform: $('platform'), aspect: $('aspect'),
  duration: $('duration'), scenes: $('scene-input-count'), tone: $('tone'), pace: $('pace'),
  seed: $('seed'), generate: $('generate'), examples: $('examples'),
  empty: $('empty'), workspace: $('workspace'), title: $('plan-title'),
  logline: $('plan-logline'), pills: $('plan-pills'), hookText: $('hook-text'),
  hookOnScreen: $('hook-onscreen'), timelineMeta: $('timeline-meta'), timeline: $('timeline'),
  refresh: $('refresh-preview'), editNote: $('edit-note'), sceneCount: $('scene-count'),
  sceneGrid: $('scene-grid'), palette: $('palette'), paletteNote: $('palette-note'),
  typeSample: $('type-sample'), typeNote: $('type-note'), audio: $('audio-panel'),
  platformNotes: $('platform-notes'), titles: $('titles'), thumbnail: $('thumbnail'),
  description: $('description'), hashtags: $('hashtags'), checklist: $('checklist'),
  productionTags: $('production-tags'), assetManifest: $('asset-manifest'),
  copyDescription: $('copy-description'), copyHashtags: $('copy-hashtags'),
  status: $('director-status'), exportGrid: document.querySelector('.export-grid'),
};

function setStatus(text, kind = '') {
  els.status.textContent = text ?? '';
  els.status.className = `director-status${kind ? ` ${kind}` : ''}`;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`);
  return data;
}

function readableInk(hex) {
  const text = String(hex ?? '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(text)) return '#ffffff';
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(text.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.38 ? '#0b0d12' : '#ffffff';
}

function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function pct(value, total) {
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function clear(el) {
  el.replaceChildren();
}

function markDirty() {
  state.dirty = true;
  els.editNote.hidden = false;
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} copied.`, 'ok');
  } catch {
    setStatus(`Could not copy ${label.toLowerCase()}.`, 'error');
  }
}

function download(filename, contentType, body) {
  const blob = new Blob([body], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------- render ---------- */

function renderPills(plan) {
  clear(els.pills);
  const pills = [
    `${plan.aspect} · ${plan.width}×${plan.height}`,
    `${plan.durationSeconds}s`,
    `${plan.fps} fps`,
    plan.platformLabel,
    plan.palette.name,
  ];
  for (const text of pills) els.pills.append(node('span', 'pill', text));
  els.pills.append(node('span', 'pill accent', `seed · ${plan.seed}`));
}

function renderTimeline(plan) {
  const board = els.timeline;
  clear(board);
  const duration = plan.durationMs || 1;

  const ruler = node('div', 'ruler');
  ruler.append(node('span', 'ruler-label', 'Time'));
  const rulerTrack = node('div', 'ruler-track');
  const steps = [1, 2, 5, 10, 15, 30, 60, 120];
  const target = plan.durationSeconds / 6;
  const step = steps.find((value) => value >= target) ?? 120;
  const ticks = [];
  for (let at = 0; at <= plan.durationSeconds + 0.001; at += step) ticks.push(at);
  if (ticks.at(-1) < plan.durationSeconds - 0.01) ticks.push(plan.durationSeconds);
  for (const at of ticks) {
    const tick = node('span', 'ruler-tick', clock(at * 1000));
    tick.style.left = pct(at * 1000, duration);
    rulerTrack.append(tick);
  }
  ruler.append(rulerTrack);
  board.append(ruler);

  const beatLane = node('div', 'beat-lane');
  beatLane.append(node('span', 'ruler-label', 'Beats'));
  const beatTrack = node('div', 'beat-track');
  for (const beat of plan.beats) {
    const marker = node('span', 'beat-marker', beat.label);
    marker.style.left = pct(beat.startMs, duration);
    beatTrack.append(marker);
  }
  beatLane.append(beatTrack);
  board.append(beatLane);

  for (const track of plan.timeline.tracks) {
    const row = node('div', `track track-${track.kind}`);
    const label = node('div', 'track-label');
    label.append(node('strong', '', track.name), node('span', '', `${track.clips.length} clip${track.clips.length === 1 ? '' : 's'}`));
    const lane = node('div', 'lane');
    for (const clip of track.clips) {
      const el = node('button', `clip ${track.kind}`, clip.label || clip.name);
      el.type = 'button';
      el.title = `${clip.name} · ${clock(clip.startMs)}–${clock(clip.endMs)}`;
      el.style.left = pct(clip.startMs, duration);
      el.style.width = pct(Math.max(clip.endMs - clip.startMs, duration * 0.004), duration);
      el.style.setProperty('--clip', clip.color);
      if (clip.sceneId) {
        el.addEventListener('click', () => {
          const card = document.getElementById(`scene-${clip.sceneId}`);
          if (!card) return;
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.focus({ preventScroll: true });
        });
      }
      lane.append(el);
    }
    row.append(label, lane);
    board.append(row);
  }
}

function sceneField(labelText, input, wide = false) {
  const label = node('label', `scene-label${wide ? ' wide' : ''}`);
  label.append(node('span', '', labelText), input);
  return label;
}

function renderScenes(plan) {
  clear(els.sceneGrid);
  els.sceneCount.textContent = `${plan.scenes.length} scenes`;
  for (const scene of plan.scenes) {
    const card = node('article', 'scene-card');
    card.id = `scene-${scene.id}`;
    card.tabIndex = -1;

    const head = node('div', 'scene-head');
    head.append(
      node('span', 'scene-num', String(scene.index).padStart(2, '0')),
      node('span', 'role', scene.role),
      node('span', 'scene-time', `${clock(scene.startMs)}–${clock(scene.endMs)}`),
    );
    const duration = node('input', 'duration-input');
    duration.type = 'number';
    duration.min = '0.3';
    duration.max = '120';
    duration.step = '0.1';
    duration.value = (scene.durationMs / 1000).toFixed(1);
    duration.title = 'Scene duration in seconds';
    duration.setAttribute('aria-label', `Scene ${scene.index} duration in seconds`);
    duration.addEventListener('change', () => {
      const value = Number(duration.value);
      if (!Number.isFinite(value) || value < 0.3) {
        duration.value = (scene.durationMs / 1000).toFixed(1);
        setStatus('Duration must be at least 0.3 seconds.', 'error');
        return;
      }
      scene.durationMs = Math.round(value * 1000);
      markDirty();
      refreshPreview({ quiet: true });
    });
    head.append(duration, node('span', 'meta-chip', `${scene.shot} / ${scene.camera}`));
    card.append(head);

    card.append(node('p', 'scene-action', scene.action));

    const caption = node('input', 'scene-input');
    caption.type = 'text';
    caption.maxLength = 72;
    caption.value = scene.onScreenText;
    caption.addEventListener('input', () => { scene.onScreenText = caption.value; markDirty(); });
    card.append(sceneField('On-screen text', caption, true));

    const voice = node('textarea', 'scene-input');
    voice.maxLength = 300;
    voice.rows = 2;
    voice.value = scene.voiceover;
    voice.addEventListener('input', () => { scene.voiceover = voice.value; markDirty(); });
    card.append(sceneField('Voiceover', voice, true));

    const promptDetails = node('details', 'prompt-details');
    promptDetails.append(node('summary', '', 'Shot details & generation prompts'));
    const meta = node('div', 'scene-meta');
    for (const text of [scene.lighting, scene.transition, scene.sound, ...scene.bRoll]) {
      if (text) meta.append(node('span', 'meta-chip', text));
    }
    promptDetails.append(meta);
    const still = node('p', 'prompt-box');
    still.append(node('strong', '', 'Still: '), document.createTextNode(scene.imagePrompt));
    const motion = node('p', 'prompt-box');
    motion.append(node('strong', '', 'Motion: '), document.createTextNode(scene.videoPrompt));
    const note = node('p', 'prompt-box');
    note.append(node('strong', '', 'Note: '), document.createTextNode(scene.notes));
    promptDetails.append(still, motion, note);
    card.append(promptDetails);

    els.sceneGrid.append(card);
  }
}

function renderPalette(plan) {
  clear(els.palette);
  for (const color of plan.palette.colors) {
    const swatch = node('button', 'swatch');
    swatch.type = 'button';
    swatch.style.background = color.hex;
    swatch.style.color = readableInk(color.hex);
    swatch.title = `Copy ${color.hex}`;
    swatch.append(
      node('span', 'role', color.role),
      node('span', 'hex', color.hex),
      node('span', 'ratio', `${color.contrastOnBackground}:1 · ${color.wcag}`),
    );
    swatch.addEventListener('click', () => copyText(color.hex, `${color.role} color`));
    els.palette.append(swatch);
  }
  els.paletteNote.textContent = plan.palette.note;
}

function renderTypography(plan) {
  clear(els.typeSample);
  const display = node('p', 'type-display', plan.typography.sample);
  display.style.fontFamily = plan.typography.display.family;
  display.style.fontWeight = String(plan.typography.display.weight);
  display.style.letterSpacing = plan.typography.display.tracking;
  display.style.textTransform = plan.typography.display.transform ?? 'none';
  display.style.fontSize = 'clamp(22px, 3vw, 34px)';
  const body = node('p', 'type-body', plan.typography.notes.join(' '));
  body.style.fontFamily = plan.typography.body.family;
  els.typeSample.append(display, body);
  els.typeNote.textContent = `${plan.typography.name} · captions ${plan.typography.caption.sizePx}px, ${plan.typography.caption.maxLines} lines max, ${plan.typography.caption.position}.`;
}

function renderAudio(plan) {
  clear(els.audio);
  const audio = plan.audio;
  els.audio.append(
    node('span', '', `Mood: ${audio.mood}`),
    node('span', '', `Tempo: ${audio.bpm.min}–${audio.bpm.max} BPM (suggested ${audio.bpm.suggested})`),
    node('span', '', `Instrumentation: ${audio.instrumentation.join(', ')}`),
    node('span', '', `Cut hint: ${audio.cutHint}`),
    node('span', '', `SFX: ${audio.sfx.join(', ') || 'none'}`),
  );
  for (const note of audio.mixNotes) els.audio.append(node('span', '', `• ${note}`));
  els.audio.append(node('span', '', audio.licenseNote));
}

function renderPlatform(plan) {
  clear(els.platformNotes);
  const notes = plan.platformNotes;
  els.platformNotes.append(node('p', 'small-copy', `${notes.platform} · native ${notes.nativeAspect} · requested ${notes.requestedAspect} · ${notes.targetDuration}`));
  els.platformNotes.append(node('p', 'small-copy', notes.safeArea));
  const list = node('ul', 'notes-list');
  for (const note of notes.notes) list.append(node('li', '', note));
  els.platformNotes.append(list);
}

function renderPublish(plan) {
  clear(els.titles);
  for (const title of plan.publish.titles) {
    const item = node('li', '', title);
    item.title = 'Copy title';
    item.addEventListener('click', () => copyText(title, 'Title'));
    els.titles.append(item);
  }

  clear(els.thumbnail);
  els.thumbnail.append(
    node('strong', '', plan.publish.thumbnail.text),
    node('span', '', plan.publish.thumbnail.subtext),
    node('span', '', plan.publish.thumbnail.composition),
    node('span', '', plan.publish.thumbnail.prompt),
  );

  els.description.textContent = plan.publish.description;
  els.hashtags.textContent = plan.publish.hashtags.join(' ');
}

function renderProduction(plan) {
  clear(els.checklist);
  for (const [index, item] of plan.production.checklist.entries()) {
    const label = node('label');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = `check-${index}`;
    const text = node('span', '', item);
    label.append(check, text);
    const li = document.createElement('li');
    li.append(label);
    els.checklist.append(li);
  }

  clear(els.productionTags);
  const tags = [...plan.production.props, ...plan.production.broll];
  for (const tag of [...new Set(tags)]) els.productionTags.append(node('span', 'tag', tag));

  clear(els.assetManifest);
  for (const asset of plan.production.assetManifest) {
    const box = node('div', 'asset');
    box.append(node('strong', '', `${asset.sceneId} · ${asset.role} · ${(asset.durationMs / 1000).toFixed(1)}s`));
    box.append(node('p', '', asset.stillPrompt));
    els.assetManifest.append(box);
  }
}

function render(plan) {
  state.plan = plan;
  state.dirty = false;
  els.empty.hidden = true;
  els.workspace.hidden = false;
  els.editNote.hidden = true;
  els.title.textContent = plan.title;
  els.logline.textContent = plan.logline;
  els.hookText.textContent = plan.hook.text;
  els.hookOnScreen.textContent = plan.hook.onScreenText;
  els.timelineMeta.textContent = `${plan.durationSeconds}s · ${plan.fps} fps · ${plan.scenes.length} scenes · ${plan.captions.length} caption cues`;
  renderPills(plan);
  renderTimeline(plan);
  renderScenes(plan);
  renderPalette(plan);
  renderTypography(plan);
  renderAudio(plan);
  renderPlatform(plan);
  renderPublish(plan);
  renderProduction(plan);
}

/* ---------- server calls ---------- */

async function generate(event) {
  event?.preventDefault();
  if (state.busy) return;
  const brief = els.brief.value.trim();
  if (brief.length < 3) {
    setStatus('Write a brief of at least a few words.', 'error');
    els.brief.focus();
    return;
  }
  const body = {
    brief,
    platform: els.platform.value,
    aspect: els.aspect.value || undefined,
    durationSeconds: els.duration.value ? Number(els.duration.value) : undefined,
    scenes: els.scenes.value ? Number(els.scenes.value) : undefined,
    tone: els.tone.value || undefined,
    pace: els.pace.value || undefined,
    seed: els.seed.value.trim() || undefined,
  };
  state.busy = true;
  els.generate.disabled = true;
  setStatus('Directing the plan…');
  try {
    const data = await api('/api/director/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    render(data.plan);
    setStatus(`Plan ready · ${data.plan.scenes.length} scenes · ${data.plan.durationSeconds}s. Download an export below.`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    state.busy = false;
    els.generate.disabled = false;
  }
}

async function refreshPreview({ quiet = false } = {}) {
  if (!state.plan || state.busy) return;
  state.busy = true;
  if (!quiet) setStatus('Reflowing the timeline…');
  try {
    const data = await api('/api/director/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'json', plan: state.plan }),
    });
    render(JSON.parse(data.body));
    setStatus('Timeline reflowed. The preview and downloads now match.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    state.busy = false;
  }
}

async function exportAs(format) {
  if (!state.plan) return;
  const button = els.exportGrid?.querySelector(`[data-format="${format}"]`);
  const label = button?.querySelector('strong')?.textContent ?? format.toUpperCase();
  if (button) button.disabled = true;
  setStatus(`Preparing ${label}…`);
  try {
    const data = await api('/api/director/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, plan: state.plan }),
    });
    download(data.filename, data.contentType, data.body);
    setStatus(`${label} downloaded · ${data.filename}`, 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

/* ---------- wiring ---------- */

els.form.addEventListener('submit', generate);
els.refresh.addEventListener('click', () => refreshPreview());
els.exportGrid?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-format]');
  if (button) exportAs(button.dataset.format);
});
els.copyDescription.addEventListener('click', () => copyText(els.description.textContent, 'Description'));
els.copyHashtags.addEventListener('click', () => copyText(els.hashtags.textContent, 'Hashtags'));

els.examples?.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-brief]');
  if (!button) return;
  els.brief.value = button.dataset.brief;
  if (button.dataset.platform) els.platform.value = button.dataset.platform;
  if (button.dataset.tone) els.tone.value = button.dataset.tone;
  els.duration.value = button.dataset.duration ?? '';
  els.scenes.value = '';
  els.aspect.value = '';
  els.pace.value = '';
  els.seed.value = '';
  generate();
});

els.brief.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') generate(event);
});

setStatus('Write a brief to generate a plan. Everything is computed locally on the server.');
