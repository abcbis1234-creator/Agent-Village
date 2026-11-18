/**
 * Pexels video search with bounded LRU caching, durable JSON persistence,
 * single-flight deduplication, and process-wide request pacing/quota control.
 * Pexels remains optional: callers receive null when no usable clip is available.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CACHE_FILE = process.env.PEXELS_CACHE_FILE || join(ROOT, 'data', 'shorts-studio', '.pexels-cache.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;
const MIN_REQUEST_INTERVAL_MS = 350;
const HOUR_MS = 60 * 60 * 1000;
const HOURLY_LIMIT = Math.max(1, Math.min(200, Number.parseInt(process.env.PEXELS_MAX_REQUESTS_PER_HOUR || '180', 10) || 180));
const API_URL = 'https://api.pexels.com/v1/videos/search';

let cache = new Map();
let cacheLoaded = false;
let cacheLoadPromise;
let persistenceQueue = Promise.resolve();
let requestQueue = Promise.resolve();
let lastRequestAt = 0;
let requestTimestamps = [];
let fetchImplementation = (...args) => fetch(...args);
let nowImplementation = () => Date.now();
const inFlight = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function normalizePexelsQuery(query) {
  if (typeof query !== 'string') return '';
  return query.normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim().split(/\s+/u).filter(Boolean).sort().join('_');
}

function touch(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

async function loadCache() {
  if (cacheLoaded) return;
  if (cacheLoadPromise) return cacheLoadPromise;
  cacheLoadPromise = (async () => {
    try {
      const parsed = JSON.parse(await readFile(CACHE_FILE, 'utf8'));
      const entries = parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object'
        ? parsed.entries : parsed;
      const now = nowImplementation();
      if (Array.isArray(parsed?.requests)) requestTimestamps = parsed.requests.filter((time) => Number.isFinite(time) && now - time < HOUR_MS);
      for (const [key, value] of Object.entries(entries || {})) {
        if (!value || typeof value !== 'object' || !Number.isFinite(value.fetchedAt)) continue;
        const staleUntil = value.staleUntil ?? value.fetchedAt + STALE_TTL_MS;
        if (staleUntil > now) touch(key, {
          data: value.data ?? null,
          fetchedAt: value.fetchedAt,
          expiresAt: value.expiresAt ?? value.fetchedAt + (value.data ? CACHE_TTL_MS : NEGATIVE_TTL_MS),
          staleUntil
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[Pexels Cache] Cache file could not be loaded:', error.message);
    } finally {
      cacheLoaded = true;
      cacheLoadPromise = null;
    }
  })();
  return cacheLoadPromise;
}

function persistCache() {
  const snapshot = {
    version: 1,
    savedAt: nowImplementation(),
    entries: Object.fromEntries([...cache.entries()].map(([key, entry]) => [key, entry])),
    requests: requestTimestamps.filter((time) => nowImplementation() - time < HOUR_MS)
  };
  const operation = persistenceQueue.then(async () => {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    const temporary = `${CACHE_FILE}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, CACHE_FILE);
  });
  persistenceQueue = operation.catch((error) => {
    console.warn('[Pexels Cache] Failed to persist cache:', error.message);
  });
  return persistenceQueue;
}

function cachedEntry(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  touch(key, entry);
  return entry;
}

async function waitForRequestSlot() {
  const now = nowImplementation();
  requestTimestamps = requestTimestamps.filter((time) => now - time < HOUR_MS);
  if (requestTimestamps.length >= HOURLY_LIMIT) {
    const waitForQuota = requestTimestamps[0] + HOUR_MS - now + 5;
    await delay(Math.max(1, waitForQuota));
  }
  const afterQuota = nowImplementation();
  requestTimestamps = requestTimestamps.filter((time) => afterQuota - time < HOUR_MS);
  const quotaWait = requestTimestamps.length >= HOURLY_LIMIT
    ? requestTimestamps[0] + HOUR_MS - afterQuota + 5 : 0;
  if (quotaWait > 0) await delay(quotaWait);

  const pacingWait = MIN_REQUEST_INTERVAL_MS - (nowImplementation() - lastRequestAt);
  if (pacingWait > 0) await delay(pacingWait);
  const startedAt = nowImplementation();
  lastRequestAt = startedAt;
  requestTimestamps.push(startedAt);
  await persistCache();
}

function scheduleRequest(task) {
  const operation = requestQueue.then(async () => {
    await waitForRequestSlot();
    return task();
  });
  requestQueue = operation.catch(() => {});
  return operation;
}

function chooseVideo(data) {
  if (!Array.isArray(data?.videos) || !data.videos.length) return null;
  const chosen = data.videos[0];
  const files = Array.isArray(chosen.video_files) ? chosen.video_files : [];
  const best = files.find((file) => file?.link && file.width >= 720 && file.height >= 1280 && file.height > file.width)
    || files.find((file) => file?.link && file.quality === 'hd')
    || files.find((file) => file?.link);
  if (!best) return null;
  return {
    videoId: chosen.id,
    videoUrl: best.link,
    previewImg: chosen.image || null,
    duration: chosen.duration,
    author: chosen.user?.name || 'Pexels Creator',
    pexelsUrl: chosen.url,
    cachedAt: new Date(nowImplementation()).toISOString()
  };
}

function storeEntry(key, data, ttl = data ? CACHE_TTL_MS : NEGATIVE_TTL_MS) {
  const fetchedAt = nowImplementation();
  touch(key, { data, fetchedAt, expiresAt: fetchedAt + ttl, staleUntil: fetchedAt + (data ? STALE_TTL_MS : ttl) });
  return persistCache();
}

export async function fetchBackgroundVideo(query) {
  const cacheKey = normalizePexelsQuery(query);
  if (!cacheKey) return null;
  await loadCache();

  const existing = cachedEntry(cacheKey);
  const now = nowImplementation();
  if (existing && existing.expiresAt > now) return existing.data;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);

  const fallback = existing && existing.staleUntil > now ? existing.data : null;
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return fallback;

  const request = (async () => {
    try {
      const cleanQuery = encodeURIComponent(String(query).trim());
      const url = `${API_URL}?query=${cleanQuery}&orientation=portrait&per_page=5&size=medium`;
      const response = await scheduleRequest(() => fetchImplementation(url, {
        headers: { Authorization: apiKey, 'User-Agent': 'AgentVillage-ShortsStudio/2.0' },
        signal: AbortSignal.timeout(15000)
      }));
      if (response.status === 429) {
        console.warn('[Pexels API] HTTP 429; using stale cache or native background fallback.');
        return fallback;
      }
      if (!response.ok) {
        console.warn(`[Pexels API] Request failed (${response.status}); using stale cache or native background fallback.`);
        return fallback;
      }
      const video = chooseVideo(await response.json());
      await storeEntry(cacheKey, video);
      return video;
    } catch (error) {
      console.warn('[Pexels API] Search failed; using stale cache or native background fallback:', error.message);
      return fallback;
    }
  })();
  inFlight.set(cacheKey, request);
  try { return await request; }
  finally { inFlight.delete(cacheKey); }
}

export async function enrichDraftWithFootage(draft) {
  if (!draft || !Array.isArray(draft.scenes)) return draft;
  for (const scene of draft.scenes) {
    const visual = scene.visual;
    const query = scene.brollQuery || (visual && typeof visual === 'object' ? visual.brollQuery : '') ||
      (typeof visual === 'string' ? visual : '') || draft.topic;
    const footage = await fetchBackgroundVideo(query);
    if (footage) {
      scene.footage = footage;
      if (visual && typeof visual === 'object') scene.visual.footage = footage;
    }
  }
  return draft;
}

export async function getCacheStats() {
  await loadCache();
  await persistenceQueue;
  const now = nowImplementation();
  const entries = [...cache.entries()];
  const live = entries.filter(([, entry]) => entry.data && entry.expiresAt > now);
  const stale = entries.filter(([, entry]) => entry.data && entry.expiresAt <= now && entry.staleUntil > now);
  requestTimestamps = requestTimestamps.filter((time) => now - time < HOUR_MS);
  return {
    cachedItemsCount: live.length,
    entriesCount: entries.length,
    staleItemsCount: stale.length,
    keys: entries.map(([key]) => key),
    requestsLastHour: requestTimestamps.length,
    hourlyLimit: HOURLY_LIMIT,
    minRequestIntervalMs: MIN_REQUEST_INTERVAL_MS,
    storagePath: CACHE_FILE,
    apiConfigured: Boolean(process.env.PEXELS_API_KEY)
  };
}

export async function purgeCache() {
  await loadCache();
  cache.clear();
  await persistCache();
  return { purged: true, ...(await getCacheStats()) };
}

// Narrow dependency injection keeps cache and pacing tests deterministic.
export function configurePexelsServiceForTests(options = {}) {
  if (options.fetch) fetchImplementation = options.fetch;
  if (options.now) nowImplementation = options.now;
  if (options.cacheFile) {
    // Tests should set PEXELS_CACHE_FILE before importing this module.
    throw new Error('Set PEXELS_CACHE_FILE before importing the Pexels service.');
  }
}
