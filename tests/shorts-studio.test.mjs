import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectInput } from '../studio/shorts-studio.mjs';

test('accepts the Shorts Studio 30–40 second project shape', () => {
  const value = validateProjectInput({
    title: 'Why is the sky blue?',
    topic: 'Light scattering',
    targetSeconds: 35,
    script: 'Sunlight contains many colours.',
    sources: [{ title: 'Science source', url: 'https://example.org/light', verified: false }],
    scenes: [{ narration: 'Sunlight enters the atmosphere.', visual: 'A cartoon sun shines over Earth.', durationSeconds: 8 }]
  });
  assert.equal(value.targetSeconds, 35);
  assert.equal(value.scenes.length, 1);
  assert.equal(value.sources[0].verified, false);
});

test('rejects a duration outside the supported range', () => {
  assert.throws(() => validateProjectInput({ title: 'Test', topic: 'Test', targetSeconds: 45 }), /30 to 40/);
});

test('rejects non-HTTP source URLs', () => {
  assert.throws(() => validateProjectInput({
    title: 'Test',
    topic: 'Test',
    sources: [{ title: 'Bad source', url: 'javascript:alert(1)' }]
  }), /HTTP or HTTPS/);
});

test('rejects malformed scene timing', () => {
  assert.throws(() => validateProjectInput({
    title: 'Test',
    topic: 'Test',
    scenes: [{ narration: 'Words', visual: 'Picture', durationSeconds: 0 }]
  }), /durationSeconds/);
});
