// lib/retry.mjs — structured retry policy (#5).
//
// Centralizes retry/backoff/jitter decisions that were previously ad hoc in the
// provider fallback path. A single `withRetry` helper classifies errors
// (429 / timeout / 5xx / parse failure / abort) and retries only the
// transient ones with exponential backoff + full jitter.

// Default classification: which errors are worth retrying.
export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false; // caller cancelled — never retry
  if (err.code === 'PROVIDER_UNAVAILABLE') return false; // circuit open — fail fast
  if (err.code === 'ALL_PROVIDERS_FAILED') return false;
  const status = Number(err.status ?? err.statusCode ?? err.response?.status);
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  if (status === 408) return true; // request timeout
  if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') return true;
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return true;
  // Parse failures from a provider are often transient (truncated stream).
  if (err.code === 'PARSE_FAILURE' || /unparseable|unexpected token|json/i.test(err.message ?? '')) return true;
  return false;
}

// Full-jitter exponential backoff: random between 0 and the capped delay.
function backoffMs(attempt, { baseMs = 250, maxMs = 8000 } = {}) {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry an async function. `fn(attempt)` receives the zero-based attempt index.
// Returns the first successful result; throws the last error if all attempts
// fail or the error is non-retryable. Honours an AbortSignal if provided.
export async function withRetry(fn, {
  retries = 3,
  baseMs = 250,
  maxMs = 8000,
  shouldRetry = isRetryable,
  signal,
  onRetry = null,
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') throw err;
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = backoffMs(attempt, { baseMs, maxMs });
      onRetry?.({ attempt, delay, error: err });
      if (delay > 0) await sleep(delay);
    }
  }
  throw lastErr;
}