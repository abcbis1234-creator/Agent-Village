import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dataDir;
let studio;
let toon2d;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'shorts-studio-test-'));
  process.env.SHORTS_STUDIO_DATA_DIR = dataDir;
  studio = await import('../studio/shorts-studio.mjs');
  toon2d = await import('../studio/toon2d-adapter.mjs');
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

test('builds the original toon2d storyboard schema from scene directions', () => {
  const script = 'A knight paid the town baker in moon coins.\nNobody had ever seen one.';
  const tokens = toon2d.scriptTokens(script);
  const wordRows = tokens.map((w, i) => ({ w, s: i * 2, e: i * 2 + 0.4, sent: i < 9 ? 0 : 1 }));
  wordRows[wordRows.length - 1].e = 29.4;
  const project = {
    title: 'Moon coins',
    status: 'approved',
    script,
    targetSeconds: 30,
    scenes: [
      { narration: 'A knight paid the town baker in moon coins.', set: 'shop_counter', mood: 'day', characterType: 'knight', pose: 'point', expression: 'smug' },
      { narration: 'Nobody had ever seen one.', set: 'street', mood: 'night', characterType: 'scientist', pose: 'think', expression: 'shocked' }
    ]
  };
  const storyboard = toon2d.buildToon2dStoryboard(project, wordRows);
  assert.equal(storyboard.fps, 30);
  assert.equal(storyboard.end_pad, 0.6);
  assert.equal(storyboard.scenes[0].start_word, 0);
  assert.equal(storyboard.scenes[1].start_word, 9);
  assert.equal(storyboard.scenes[0].set, 'shop_counter');
  assert.equal(storyboard.scenes[0].cast[0].type, 'knight');
  assert.equal(storyboard.scenes[1].mood, 'night');
});

test('rejects scene narration that cannot be located in the script', () => {
  const project = {
    title: 'Missing line',
    script: 'The sky is blue.',
    targetSeconds: 30,
    scenes: [{ narration: 'The ocean is green.', set: 'field', mood: 'day' }]
  };
  const wordRows = toon2d.scriptTokens(project.script).map((w, i) => ({ w, s: i, e: i + 0.2 }));
  assert.throws(() => toon2d.buildToon2dStoryboard(project, wordRows), /must appear in the script/);
});
