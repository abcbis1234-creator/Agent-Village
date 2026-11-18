import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = await mkdtemp(join(tmpdir(), 'shorts-cache-api-test-'));
process.env.PEXELS_CACHE_FILE = join(tempDir, 'cache.json');
const { handleShortsApi } = await import('../studio/shorts-api.mjs');

function responseCapture() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
}

test('GET /api/shorts/cache exposes cache and quota metrics', async () => {
  const res = responseCapture();
  const handled = await handleShortsApi({ method: 'GET' }, res, new URL('http://localhost/api/shorts/cache'));
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.cachedItemsCount, 0);
  assert.equal(payload.hourlyLimit, 180);
  assert.equal(payload.apiConfigured, false);
});

test('POST /api/shorts/cache/purge clears the cache through the API', async () => {
  const res = responseCapture();
  const handled = await handleShortsApi({ method: 'POST' }, res, new URL('http://localhost/api/shorts/cache/purge'));
  assert.equal(handled, true);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).purged, true);
});

test.after(async () => {
  delete process.env.PEXELS_CACHE_FILE;
  await rm(tempDir, { recursive: true, force: true });
});
