import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planProject, exportProject, buildExports, cleanTopic,
  ASPECTS, FORMATS,
} from '../lib/director.mjs';

const brief = 'A 30 second premium promo for my coffee shop';
const options = { brief, durationSeconds: 30, scenes: 8, platform: 'tiktok', tone: 'premium', pace: 'medium', seed: 'test-seed' };

test('plan is deterministic for the same brief and seed', () => {
  const first = planProject(options);
  const second = planProject(options);
  assert.deepEqual(first, second);
  assert.equal(first.scenes.length, 8);
  assert.equal(first.durationMs, 30_000);
  assert.equal(first.scenes.at(-1).endMs, 30_000);
  assert.equal(first.title, first.publish.title);
});

test('infers platform, tone, and duration from the brief', () => {
  const plan = planProject({ brief: 'Make a calm 45-second reel about a skincare routine', scenes: 6, seed: 'infer' });
  assert.equal(plan.platform, 'reels');
  assert.equal(plan.aspect, '9:16');
  assert.equal(plan.tone, 'calm');
  assert.equal(plan.durationSeconds, 45);
  assert.equal(plan.topic, 'skincare routine');
});

test('keeps topic extraction useful across common brief shapes', () => {
  assert.equal(cleanTopic('a 30 second promo for my coffee shop'), 'coffee shop');
  assert.equal(cleanTopic('Launch video for a solar-powered backpack'), 'solar-powered backpack');
  assert.equal(cleanTopic('Create a TikTok about street food in Bangkok'), 'street food in Bangkok');
  assert.equal(cleanTopic('A technical explainer about how our database works'), 'how our database works');
});

test('scene timings are contiguous and captions stay inside their scenes', () => {
  const plan = planProject(options);
  let cursor = 0;
  for (const scene of plan.scenes) {
    assert.equal(scene.startMs, cursor);
    assert.ok(scene.endMs > scene.startMs);
    cursor = scene.endMs;
  }
  assert.equal(cursor, plan.durationMs);
  let captionCursor = 0;
  for (const cue of plan.captions) {
    assert.ok(cue.startMs >= captionCursor);
    assert.ok(cue.endMs > cue.startMs);
    assert.ok(cue.text.trim().length > 0);
    captionCursor = cue.endMs;
  }
});

test('palette reports measurable contrast and a usable ink color', () => {
  const plan = planProject(options);
  assert.equal(plan.palette.colors.length, 6);
  for (const color of plan.palette.colors) {
    assert.match(color.hex, /^#[0-9a-f]{6}$/i);
    assert.ok(color.contrastOnBackground >= 1);
  }
  const ink = plan.palette.colors.find((color) => color.role === 'ink');
  assert.ok(ink.contrastOnBackground >= 4.5);
});

test('builds every advertised export', () => {
  const plan = planProject(options);
  const exports = buildExports(plan);
  assert.deepEqual(Object.keys(exports).sort(), Object.keys(FORMATS).sort());
  assert.match(exports.srt, /^1\n00:00:00,000 --> /);
  assert.match(exports.vtt, /^WEBVTT\n\n1\n00:00:00\.000 --> /);
  assert.match(exports.edl, /^TITLE: {3}COFFEE SHOP/m);
  assert.equal((exports.edl.match(/^001 {2}AX/m) ?? []).length, 1);
  assert.match(exports.fcpxml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(exports.fcpxml, /<fcpxml version="1.9">/);
  assert.equal(JSON.parse(exports.otio).OTIO_SCHEMA, 'Timeline.1');
  assert.match(exports.markdown, /## Storyboard/);
  assert.match(exports.youtube, /TITLE OPTIONS/);
  assert.equal(JSON.parse(exports.json).schema, 'agent-village/director-project@1');
});

test('CSV and FCPXML escape user content', () => {
  const plan = planProject({ brief: 'A product teaser', durationSeconds: 15, scenes: 4, seed: 'escape' });
  plan.scenes[0].onScreenText = 'He said "Hot, Fresh"';
  plan.title = 'A <script> & "quoted" title';
  const exports = buildExports(plan);
  assert.match(exports.csv, /"He said ""Hot, Fresh"""/);
  assert.match(exports.fcpxml, /&lt;script&gt;/);
  assert.match(exports.fcpxml, /&amp;/);
  assert.doesNotMatch(exports.fcpxml, /<script>/);
});

test('exportProject returns a download descriptor and validates formats', () => {
  const plan = planProject(options);
  const srt = exportProject({ format: 'srt', plan });
  assert.equal(srt.format, 'srt');
  assert.equal(srt.contentType, FORMATS.srt.contentType);
  assert.match(srt.filename, /\.srt$/);
  assert.match(srt.body, /-->/);
  assert.throws(() => exportProject({ format: 'mp4', plan }), /format must be one of/);
});

test('rejects invalid plan and export input', () => {
  assert.throws(() => planProject({ brief: '' }), /brief/);
  assert.throws(() => planProject({ brief: 'a product teaser', durationSeconds: 3 }), /durationSeconds/);
  assert.throws(() => planProject({ brief: 'a teaser', durationSeconds: 5, scenes: 12 }), /scenes must be/);
  assert.throws(() => planProject({ brief: 'a teaser', aspect: '3:2' }), /aspect/);
  assert.throws(() => planProject({ brief: 'a teaser', platform: 'myspace' }), /platform/);
  assert.throws(() => planProject({ brief: 'a teaser', tone: 'angry' }), /tone/);
  assert.throws(() => exportProject({ format: 'srt', plan: { scenes: [] } }), /non-empty/);
  assert.throws(() => exportProject({ format: 'srt', plan: null }), /plan must be an object/);
});

test('export accepts an edited plan and reflows the timeline', () => {
  const plan = planProject(options);
  const edited = structuredClone(plan);
  edited.scenes = edited.scenes.slice(0, 3);
  edited.scenes[0].durationMs = 4_000;
  edited.scenes[1].onScreenText = 'EDITED CAPTION';
  const exported = exportProject({ format: 'markdown', plan: edited });
  assert.match(exported.body, /EDITED CAPTION/);
  assert.equal(JSON.parse(exportProject({ format: 'json', plan: edited }).body).durationMs, edited.scenes.reduce((sum, scene) => sum + scene.durationMs, 0));
});

test('reflowing an edited plan updates duration-bearing copy', () => {
  const plan = planProject({ brief: 'Create a TikTok about street food in Bangkok', durationSeconds: 30, scenes: 6, seed: 'reflow' });
  const edited = structuredClone(plan);
  edited.scenes[0].durationMs += 1_300;
  const out = JSON.parse(exportProject({ format: 'json', plan: edited }).body);
  assert.equal(out.durationSeconds, 31.3);
  assert.match(out.title, /31\.3 Seconds/);
  assert.match(out.logline, /31\.3-second/);
  assert.match(out.hook.text, /31\.3 seconds/);
  assert.match(out.publish.description, /31\.3-second/);
  assert.match(out.publish.thumbnail.subtext, /31\.3 Seconds/);
});

test('all aspect presets produce the expected canvas', () => {
  for (const [aspect, data] of Object.entries(ASPECTS)) {
    const plan = planProject({ brief: 'A quick product story', aspect, durationSeconds: 15, scenes: 4, seed: `aspect-${aspect}` });
    assert.equal(plan.width, data.width);
    assert.equal(plan.height, data.height);
  }
});

test('one-second minimum survives dense scene requests', () => {
  const plan = planProject({ brief: 'A five second teaser', durationSeconds: 5, scenes: 8, seed: 'dense' });
  assert.equal(plan.durationMs, 5_000);
  assert.ok(plan.scenes.every((scene) => scene.durationMs >= 600));
  assert.equal(plan.scenes.reduce((sum, scene) => sum + scene.durationMs, 0), 5_000);
});
