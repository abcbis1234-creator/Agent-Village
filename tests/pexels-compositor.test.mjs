import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedPexelsVideoUrl, planCompositeSegments } from '../studio/pexels-compositor.mjs';

test('accepts HTTPS URLs hosted by Pexels and its subdomains', () => {
  assert.equal(isAllowedPexelsVideoUrl('https://videos.pexels.com/video-files/123/example.mp4'), true);
  assert.equal(isAllowedPexelsVideoUrl('https://pexels.com/video/123/'), true);
});

test('rejects non-HTTPS and non-Pexels clip URLs', () => {
  assert.equal(isAllowedPexelsVideoUrl('http://videos.pexels.com/video.mp4'), false);
  assert.equal(isAllowedPexelsVideoUrl('https://example.com/video.mp4'), false);
  assert.equal(isAllowedPexelsVideoUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedPexelsVideoUrl('https://pexels.com.evil.example/video.mp4'), false);
});

test('maps approved scene footage to the matching Toon2D time ranges', () => {
  const plan = { scenes: [{ t0: 0, t1: 8 }, { t0: 8, t1: 17.5 }] };
  const scenes = [{ visual: 'Ocean', footage: null }, { visual: 'Space' }];
  const footage = [null, { videoUrl: 'https://videos.pexels.com/video-files/123/example.mp4', videoId: 123 }];
  const segments = planCompositeSegments(plan, scenes, footage);
  assert.deepEqual(segments.map((s) => [s.index, s.start, s.duration]), [[0, 0, 8], [1, 8, 9.5]]);
  assert.equal(segments[0].footage, null);
  assert.equal(segments[1].footage.videoId, 123);
});

test('rejects mismatched or overlapping scene timing plans', () => {
  assert.throws(() => planCompositeSegments({ scenes: [{ t0: 0, t1: 8 }] }, [{}, {}]), /must match/);
  assert.throws(() => planCompositeSegments({ scenes: [{ t0: 0, t1: 8 }, { t0: 7, t1: 10 }] }, [{}, {}]), /invalid or overlap/);
});
