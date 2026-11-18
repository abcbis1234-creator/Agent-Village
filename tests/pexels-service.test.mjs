import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'pexels-cache-test-'));
process.env.PEXELS_CACHE_FILE = join(tempDir, 'cache.json');
process.env.PEXELS_API_KEY = 'test-key';
let clockOffset = 0;
let fetchCalls = 0;
const fetchTimes = [];
let nextStatus = 200;
const fakeNow = () => Date.now() + clockOffset;
const fakeFetch = async () => {
  fetchCalls += 1;
  fetchTimes.push(Date.now());
  if (nextStatus === 429) return { status: 429, ok: false };
  return {
    status: 200,
    ok: true,
    json: async () => ({
      videos: [{
        id: 123,
        image: 'https://images.pexels.com/example.jpg',
        duration: 12,
        url: 'https://www.pexels.com/video/123/',
        user: { name: 'Example Creator' },
        video_files: [{ width: 1080, height: 1920, quality: 'hd', link: 'https://videos.pexels.com/example.mp4' }]
      }]
    })
  };
};

const service = await import('../studio/pexels-service.mjs');
service.configurePexelsServiceForTests({ fetch: fakeFetch, now: fakeNow });

test('normalizes punctuation and word order into a canonical key', () => {
  assert.equal(service.normalizePexelsQuery('Deep Ocean!'), 'deep_ocean');
  assert.equal(service.normalizePexelsQuery('ocean deep'), 'deep_ocean');
  assert.equal(service.normalizePexelsQuery('  DEEP   ocean  '), 'deep_ocean');
});

test('caches a Pexels result and deduplicates equivalent queries', async () => {
  const first = await service.fetchBackgroundVideo('Deep Ocean!');
  assert.equal(first.videoId, 123);
  assert.equal(first.author, 'Example Creator');
  const second = await service.fetchBackgroundVideo('ocean deep');
  assert.deepEqual(second, first);
  assert.equal(fetchCalls, 1);
});

test('serializes distinct upstream requests at the configured pace', async () => {
  await service.fetchBackgroundVideo('deep space');
  await service.fetchBackgroundVideo('blue planet');
  assert.equal(fetchCalls, 3);
  assert.ok(fetchTimes[2] - fetchTimes[1] >= 330);
  const stats = await service.getCacheStats();
  assert.equal(stats.requestsLastHour, 3);
});

test('persists cached entries across module reloads', async () => {
  const reloaded = await import(`../studio/pexels-service.mjs?reload=${Date.now()}`);
  reloaded.configurePexelsServiceForTests({ fetch: fakeFetch, now: fakeNow });
  const result = await reloaded.fetchBackgroundVideo('ocean deep');
  assert.equal(result.videoId, 123);
  assert.equal(fetchCalls, 3);
});

test('serves stale cached footage when Pexels returns HTTP 429', async () => {
  clockOffset += 8 * 24 * 60 * 60 * 1000;
  nextStatus = 429;
  const result = await service.fetchBackgroundVideo('deep ocean');
  assert.equal(result.videoId, 123);
  assert.equal(fetchCalls, 4);
  const stats = await service.getCacheStats();
  assert.equal(stats.staleItemsCount, 3);
  assert.equal(stats.requestsLastHour, 1);
});

test('purges both memory and persistent cache state', async () => {
  const result = await service.purgeCache();
  assert.equal(result.purged, true);
  assert.equal(result.cachedItemsCount, 0);
  assert.equal(result.entriesCount, 0);
});

test.after(async () => {
  delete process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_CACHE_FILE;
  await rm(tempDir, { recursive: true, force: true });
});
