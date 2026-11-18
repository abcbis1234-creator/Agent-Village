import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir;
let studio;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'shorts-studio-test-'));
  process.env.SHORTS_STUDIO_DATA_DIR = dataDir;
  studio = await import('../studio/shorts-studio.mjs');
});

after(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  delete process.env.SHORTS_STUDIO_DATA_DIR;
});

const validProject = (title = 'Why is the sky blue?') => ({
  title,
  topic: 'Light scattering',
  audience: 'Curious learners',
  targetSeconds: 30,
  script: 'Sunlight contains many colours. Air molecules scatter blue light more strongly.',
  sources: [{ title: 'Science source', url: 'https://example.org/light', notes: 'Explains scattering', verified: true }],
  scenes: [
    { narration: 'Why is the sky blue?', visual: 'A curious cartoon character looks upward.', durationSeconds: 8 },
    { narration: 'Air scatters blue light more strongly.', visual: 'Blue light spreads across the sky.', durationSeconds: 12 },
    { narration: 'That is why the sky looks blue.', visual: 'The character points to a bright blue sky.', durationSeconds: 10 }
  ]
});

test('accepts a valid 30–40 second project shape', () => {
  const value = studio.validateProjectInput(validProject());
  assert.equal(value.targetSeconds, 30);
  assert.equal(value.scenes.length, 3);
  assert.equal(value.sources[0].verified, true);
});

test('rejects a duration outside the supported range', () => {
  assert.throws(() => studio.validateProjectInput({ title: 'Test', topic: 'Test', targetSeconds: 45 }), /30 to 40/);
});

test('rejects non-HTTP source URLs', () => {
  assert.throws(() => studio.validateProjectInput({
    title: 'Test',
    topic: 'Test',
    sources: [{ title: 'Bad source', url: 'javascript:alert(1)' }]
  }), /HTTP or HTTPS/);
});

test('rejects malformed scene timing', () => {
  assert.throws(() => studio.validateProjectInput({
    title: 'Test',
    topic: 'Test',
    scenes: [{ narration: 'Words', visual: 'Picture', durationSeconds: 0 }]
  }), /durationSeconds/);
});

test('creates, lists, edits, and retrieves a draft', async () => {
  const created = await studio.createShortsProject(validProject());
  assert.equal(created.status, 'draft');
  assert.equal((await studio.getShortsProject(created.id)).title, created.title);
  assert.equal((await studio.listShortsProjects()).length, 1);

  const updated = await studio.updateShortsProject(created.id, { title: 'Why is the daytime sky blue?' });
  assert.equal(updated.title, 'Why is the daytime sky blue?');
  assert.equal(updated.history.at(-1).type, 'updated');
});

test('requires sources and correctly timed scenes before review', async () => {
  const project = await studio.createShortsProject({ ...validProject(), sources: [{ ...validProject().sources[0], verified: false }] });
  await assert.rejects(() => studio.submitShortsProject(project.id), /mark each one as checked/);
});

test('submits and approves a complete project, then locks it', async () => {
  const project = await studio.createShortsProject(validProject());
  const submitted = await studio.submitShortsProject(project.id);
  assert.equal(submitted.status, 'review');

  const approved = await studio.approveShortsProject(project.id, 'Reviewed');
  assert.equal(approved.status, 'approved');
  assert.equal(approved.history.at(-1).type, 'approved');
  await assert.rejects(() => studio.updateShortsProject(project.id, { title: 'Changed after approval' }), /locked/);
});

test('supports requesting changes and returning the project to draft', async () => {
  const project = await studio.createShortsProject(validProject('A second project'));
  await studio.submitShortsProject(project.id);
  const rejected = await studio.rejectShortsProject(project.id, 'Clarify the explanation');
  assert.equal(rejected.status, 'rejected');

  const revised = await studio.updateShortsProject(project.id, { script: 'A clearer explanation of light scattering.' });
  assert.equal(revised.status, 'draft');
  assert.equal(revised.history.at(-1).type, 'updated');
});
