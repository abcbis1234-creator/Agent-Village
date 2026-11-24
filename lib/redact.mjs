// lib/redact.mjs — secret redaction pipeline (#11).
//
// Redacts secrets from any value (string, object, array) before it is logged,
// emitted over SSE, persisted to the audit log, included in an export, or
// thrown in an error. Patterns cover common credential shapes; the redactor is
// conservative (over-redacts rather than leaks).

const PATTERNS = [
  // OpenAI / Anthropic / generic sk- keys
  { re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, label: '[REDACTED_KEY]' },
  // Bearer tokens
  { re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, label: 'Bearer [REDACTED]' },
  // AWS access key IDs
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: '[REDACTED_AWS_KEY]' },
  // Private key blocks
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: '[REDACTED_PRIVATE_KEY]' },
  // github_pat_ / ghp_ / gho_ tokens
  { re: /\b(?:github_pat_|ghp_|gho_|ghu_|ghs_)[A-Za-z0-9_]{20,}\b/g, label: '[REDACTED_GITHUB_TOKEN]' },
  // key=value / key: value forms for sensitive names
  { re: /\b(api[_-]?key|access[_-]?token|secret|password|passwd|pwd|client[_-]?secret)\b\s*[:=]\s*\S+/gi, label: '$1=[REDACTED]' },
  // Slack tokens
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, label: '[REDACTED_SLACK_TOKEN]' },
];

const SENSITIVE_KEYS = new Set([
  'api_key', 'apikey', 'api-key', 'access_token', 'accesstoken', 'access-token',
  'secret', 'password', 'passwd', 'pwd', 'client_secret', 'clientsecret',
  'authorization', 'auth', 'token', 'private_key', 'privatekey',
]);

function redactString(s) {
  let out = String(s);
  for (const { re, label } of PATTERNS) out = out.replace(re, label);
  return out;
}

// Recursively redact a value. Objects/arrays are walked; sensitive keys have
// their values replaced wholesale. Non-plain values (Date, etc.) are string-
// ified and redacted. Returns a new structure; the input is not mutated.
export function redact(value, depth = 0) {
  if (depth > 20) return '[REDACTED_TOO_DEEP]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) out[k] = '[REDACTED]';
      else out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return redactString(String(value));
}

// Redact an Error's message and stack, returning a plain object safe to log or
// emit. Never throws.
export function redactError(err) {
  if (!err) return { message: '[REDACTED_UNKNOWN_ERROR]' };
  return {
    name: err.name ?? 'Error',
    message: redactString(err.message ?? String(err)),
    code: err.code,
    stack: err.stack ? redactString(err.stack) : undefined,
  };
}

// True if the string contains anything that looks like a secret. Useful for
// tests and for deciding whether to redact at all.
export function containsSecret(s) {
  const str = String(s ?? '');
  return PATTERNS.some(({ re }) => { re.lastIndex = 0; return re.test(str); });
}