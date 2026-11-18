import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const storePath = join(process.env.SHORTS_STUDIO_DATA_DIR || join(root, 'data'), 'shorts-projects.json');
let writeQueue = Promise.resolve();

const editableFields = new Set(['title', 'topic', 'audience', 'targetSeconds', 'script', 'sources', 'scenes']);
const toon2dSets = new Set(['street', 'kitchen', 'office', 'shop_counter', 'planet_shop', 'ship_deck', 'desert_rails', 'castle_hall', 'field', 'town_top', 'prehistoric']);
const toon2dMoods = new Set(['day', 'interior', 'night', 'dream', 'golden', 'sunset', 'dawn']);
const toon2dCharacters = new Set(['worker', 'boss', 'cop', 'cook', 'knight', 'king', 'scientist', 'cashier', 'sailor', 'caveman', 'kid', 'alien']);
const toon2dPoses = new Set(['stand', 'walk', 'run', 'point', 'shrug', 'arms_crossed', 'hips', 'hold', 'think', 'wave', 'cheer', 'sit']);
const toon2dExpressions = new Set(['neutral', 'smug', 'angry', 'shocked', 'laughing', 'scared', 'sad', 'sly', 'happy', 'deadpan']);

function cleanText(value, field, max) {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new Error(`${field} must be between 1 and ${max} characters`);
  return cleaned;
}

export function validateProjectInput(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('project must be an object');
  const result = {};
  if (!partial || Object.hasOwn(input, 'title')) result.title = cleanText(input.title, 'title', 100);
  if (!partial || Object.hasOwn(input, 'topic')) result.topic = cleanText(input.topic, 'topic', 240);
  if (Object.hasOwn(input, 'audience')) result.audience = cleanText(input.audience, 'audience', 160);
  if (Object.hasOwn(input, 'targetSeconds')) {
    if (!Number.isInteger(input.targetSeconds) || input.targetSeconds < 30 || input.targetSeconds > 40) throw new Error('targetSeconds must be an integer from 30 to 40');
    result.targetSeconds = input.targetSeconds;
  } else if (!partial) result.targetSeconds = 35;
  if (Object.hasOwn(input, 'script')) {
    if (typeof input.script !== 'string' || input.script.length > 5000) throw new Error('script must be text of at most 5000 characters');
    result.script = input.script.trim();
  } else if (!partial) result.script = '';
  if (Object.hasOwn(input, 'sources')) {
    if (!Array.isArray(input.sources) || input.sources.length > 12) throw new Error('sources must be an array of at most 12 items');
    result.sources = input.sources.map((source) => {
      if (!source || typeof source !== 'object') throw new Error('each source must be an object');
      const title = cleanText(source.title, 'source title', 160);
      const url = cleanText(source.url, 'source URL', 1000);
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error('source URL must be a valid HTTP or HTTPS URL'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('source URL must use HTTP or HTTPS');
      return { title, url: parsed.toString(), notes: typeof source.notes === 'string' ? source.notes.slice(0, 1000) : '', verified: source.verified === true };
    });
  } else if (!partial) result.sources = [];
  if (Object.hasOwn(input, 'scenes')) {
    if (!Array.isArray(input.scenes) || input.scenes.length > 12) throw new Error('scenes must be an array of at most 12 items');
    result.scenes = input.scenes.map((scene, index) => {
      if (!scene || typeof scene !== 'object') throw new Error('each scene must be an object');
      const narration = cleanText(scene.narration, `scene ${index + 1} narration`, 800);
      const visual = cleanText(scene.visual, `scene ${index + 1} visual`, 800);
      if (!Number.isInteger(scene.durationSeconds) || scene.durationSeconds < 1 || scene.durationSeconds > 15) throw new Error('scene durationSeconds must be an integer from 1 to 15');
      const set = scene.set ?? 'field';
      const mood = scene.mood ?? 'day';
      const characterType = scene.characterType ?? 'scientist';
      const pose = scene.pose ?? 'stand';
      const expression = scene.expression ?? 'neutral';
      if (!toon2dSets.has(set)) throw new Error(`scene ${index + 1} has an unsupported toon2d set`);
      if (!toon2dMoods.has(mood)) throw new Error(`scene ${index + 1} has an unsupported toon2d mood`);
      if (!toon2dCharacters.has(characterType)) throw new Error(`scene ${index + 1} has an unsupported toon2d character`);
      if (!toon2dPoses.has(pose)) throw new Error(`scene ${index + 1} has an unsupported toon2d pose`);
      if (!toon2dExpressions.has(expression)) throw new Error(`scene ${index + 1} has an unsupported toon2d expression`);
      return { id: typeof scene.id === 'string' && scene.id ? scene.id : randomUUID(), narration, visual, durationSeconds: scene.durationSeconds, set, mood, characterType, pose, expression };
    });
  } else if (!partial) result.scenes = [];
  for (const key of Object.keys(input)) if (!editableFields.has(key)) throw new Error(`field is not editable: ${key}`);
  return result;
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    return Array.isArray(parsed.projects) ? parsed : { version: 1, projects: [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, projects: [] };
    throw new Error('Shorts Studio storage could not be read; no data was changed');
  }
}

async function writeStore(store) {
  await mkdir(dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, storePath);
}

function mutateStore(mutator) {
  const operation = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

function logEvent(project, type, note) {
  project.history.push({ id: randomUUID(), type, note, at: new Date().toISOString() });
  project.updatedAt = new Date().toISOString();
}

function publicProject(project) {
  return structuredClone(project);
}

export async function listShortsProjects() {
  await writeQueue;
  const store = await readStore();
  return store.projects.map(publicProject).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getShortsProject(id) {
  await writeQueue;
  const store = await readStore();
  const project = store.projects.find((item) => item.id === id);
  return project ? publicProject(project) : null;
}

export async function createShortsProject(input) {
  const values = validateProjectInput(input);
  return mutateStore((store) => {
    const now = new Date().toISOString();
    const project = {
      id: randomUUID(),
      ...values,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      history: [{ id: randomUUID(), type: 'created', note: 'Project created', at: now }]
    };
    store.projects.push(project);
    return publicProject(project);
  });
}

export async function updateShortsProject(id, input) {
  const values = validateProjectInput(input, true);
  if (!Object.keys(values).length) throw new Error('provide at least one editable field');
  return mutateStore((store) => {
    const project = store.projects.find((item) => item.id === id);
    if (!project) return null;
    if (project.status === 'approved') throw new Error('approved projects are locked; create a new revision instead');
    if (project.status === 'review') throw new Error('projects under review are locked until the reviewer responds');
    Object.assign(project, values);
    if (project.status === 'rejected') project.status = 'draft';
    logEvent(project, 'updated', 'Project content updated');
    return publicProject(project);
  });
}

function checkReady(project) {
  if (!project.title || !project.topic || !project.script) throw new Error('add a title, topic, and script before review');
  if (!project.scenes.length) throw new Error('add at least one storyboard scene before review');
  const total = project.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  if (Math.abs(total - project.targetSeconds) > 3) throw new Error(`scene durations total ${total}s; adjust them to within 3 seconds of the ${project.targetSeconds}s target`);
  if (!project.sources.length || project.sources.some((source) => !source.verified)) throw new Error('add sources and mark each one as checked before review');
}

export async function submitShortsProject(id) {
  return mutateStore((store) => {
    const project = store.projects.find((item) => item.id === id);
    if (!project) return null;
    if (project.status === 'approved') throw new Error('project is already approved');
    checkReady(project);
    project.status = 'review';
    logEvent(project, 'submitted', 'Submitted for human review');
    return publicProject(project);
  });
}

export async function approveShortsProject(id, reviewerNote = '') {
  return mutateStore((store) => {
    const project = store.projects.find((item) => item.id === id);
    if (!project) return null;
    if (project.status !== 'review') throw new Error('only projects in review can be approved');
    project.status = 'approved';
    logEvent(project, 'approved', typeof reviewerNote === 'string' ? reviewerNote.slice(0, 500) || 'Approved by human reviewer' : 'Approved by human reviewer');
    return publicProject(project);
  });
}

export async function rejectShortsProject(id, reviewerNote = '') {
  return mutateStore((store) => {
    const project = store.projects.find((item) => item.id === id);
    if (!project) return null;
    if (project.status !== 'review') throw new Error('only projects in review can be rejected');
    project.status = 'rejected';
    logEvent(project, 'rejected', typeof reviewerNote === 'string' ? reviewerNote.slice(0, 500) || 'Changes requested' : 'Changes requested');
    return publicProject(project);
  });
}
