// lib/json.mjs — zero-dependency, safe JSON extraction + repair.
//
// Research basis: the "json-repair" family (nathanpixodeo/json-repair,
// eugenepokalyuk/llm-json-repair, @datatool/json-heal). The design points that
// matter for an agent runtime:
//   - parser-driven, not regex-driven (a greedy /\{[\s\S]*\}/ spans multiple
//     objects and cannot close truncation)
//   - no eval and no Node built-ins (works in any runtime)
//   - hard depth/length limits (LLM output is untrusted)
//   - tolerate what models actually emit: fences, prose, single quotes,
//     unquoted keys, trailing commas, comments, truncation, NaN/Infinity
//
// `extractJson` returns a value or undefined. It never throws.

export const DEFAULT_LIMITS = { maxDepth: 32, maxLength: 1_000_000, maxCandidates: 12 };

const SAFE_KEY_EXCLUDE = new Set(['__proto__', 'constructor', 'prototype']);

function preferredSource(text) {
  const s = String(text ?? '');
  const fence = s.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  return fence ? fence[1] : s;
}

function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isIdentStart(c) { return /[A-Za-z_$]/.test(c); }
function startsValue(c) {
  return c === '{' || c === '[' || c === '"' || c === "'" || c === '-' || c === '+' || /[0-9]/.test(c) || isIdentStart(c);
}

function looksLikeObjectStart(s, i) {
  let j = i + 1;
  while (j < s.length && isWs(s[j])) j++;
  if (s[j] === '}' || s[j] === '"' || s[j] === "'") return true;
  if (isIdentStart(s[j])) {
    let k = j;
    while (k < s.length && /[A-Za-z0-9_$-]/.test(s[k])) k++;
    while (k < s.length && isWs(s[k])) k++;
    return s[k] === ':' || s[k] === '=';
  }
  return false;
}

function looksLikeArrayStart(s, i) {
  let j = i + 1;
  while (j < s.length && isWs(s[j])) j++;
  return s[j] === ']' || s[j] === '"' || s[j] === "'" || s[j] === '{' || s[j] === '[' ||
    s[j] === '-' || /[0-9]/.test(s[j]) || /^(?:true|false|null)\b/.test(s.slice(j, j + 5));
}

class LooseParser {
  constructor(src, limits) {
    this.src = src;
    this.i = 0;
    this.n = src.length;
    this.depth = 0;
    this.limits = limits;
  }

  error(message) { const e = new Error(message); e.code = 'JSON_REPAIR'; throw e; }

  skip() {
    const s = this.src;
    while (this.i < this.n) {
      const c = s[this.i];
      if (isWs(c)) { this.i++; continue; }
      if (c === '/' && s[this.i + 1] === '/') {
        this.i += 2;
        while (this.i < this.n && s[this.i] !== '\n') this.i++;
        continue;
      }
      if (c === '/' && s[this.i + 1] === '*') {
        this.i += 2;
        while (this.i < this.n - 1 && !(s[this.i] === '*' && s[this.i + 1] === '/')) this.i++;
        this.i = Math.min(this.n, this.i + 2);
        continue;
      }
      break;
    }
  }

  value() {
    this.skip();
    if (this.i >= this.n) return null;
    const c = this.src[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"' || c === "'") return this.string();
    const num = this.number();
    if (num !== null) return num;
    return this.literal();
  }

  object() {
    this.depth++;
    if (this.depth > this.limits.maxDepth) this.error('max depth exceeded');
    this.i++; // {
    const obj = {};
    const s = this.src;
    while (true) {
      this.skip();
      if (this.i >= this.n) break;
      if (s[this.i] === '}') { this.i++; break; }
      const key = (s[this.i] === '"' || s[this.i] === "'") ? this.string() : this.bareKey();
      this.skip();
      if (s[this.i] === ':' || s[this.i] === '=') this.i++;
      const val = this.value();
      if (key && !SAFE_KEY_EXCLUDE.has(key)) obj[key] = val;
      this.skip();
      if (this.i >= this.n) break;
      if (s[this.i] === ',') { this.i++; continue; }
      if (s[this.i] === '}' || s[this.i] === ']') { this.i++; break; }
      if (!startsValue(s[this.i])) this.i++; // skip stray punctuation
    }
    this.depth--;
    return obj;
  }

  array() {
    this.depth++;
    if (this.depth > this.limits.maxDepth) this.error('max depth exceeded');
    this.i++; // [
    const arr = [];
    const s = this.src;
    while (true) {
      this.skip();
      if (this.i >= this.n) break;
      if (s[this.i] === ']' || s[this.i] === '}') { this.i++; break; }
      arr.push(this.value());
      this.skip();
      if (this.i >= this.n) break;
      if (s[this.i] === ',') { this.i++; continue; }
      if (s[this.i] === ']' || s[this.i] === '}') { this.i++; break; }
      if (!startsValue(s[this.i])) this.i++;
    }
    this.depth--;
    return arr;
  }

  string() {
    const s = this.src;
    const quote = s[this.i++];
    let out = '';
    while (this.i < this.n) {
      const c = s[this.i];
      if (c === '\\') {
        const e = s[this.i + 1];
        this.i += 2;
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === 'b') out += '\b';
        else if (e === 'f') out += '\f';
        else if (e === 'u') {
          const hex = s.slice(this.i, this.i + 4);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); this.i += 4; }
          else out += 'u';
        } else if (e === undefined) { out += '\\'; }
        else out += e;
        continue;
      }
      if (c === quote) { this.i++; return out; }
      if (c === '\n' || c === '\r') return out; // unterminated string at newline
      out += c;
      this.i++;
    }
    return out; // truncated string
  }

  bareKey() {
    const s = this.src;
    const start = this.i;
    while (this.i < this.n) {
      const c = s[this.i];
      if (c === ':' || c === '=' || isWs(c) || c === ',' || c === '}' || c === '{' || c === '[' || c === ']') break;
      this.i++;
    }
    return s.slice(start, this.i).replace(/^['"]|['"]$/g, '');
  }

  number() {
    const rest = this.src.slice(this.i);
    const m = rest.match(/^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/);
    if (!m) return null;
    this.i += m[0].length;
    if (/^[+-]?0[xX]/.test(m[0])) return parseInt(m[0].replace(/^\+/, ''), 16);
    const v = Number(m[0]);
    return Number.isFinite(v) ? v : null;
  }

  literal() {
    const rest = this.src.slice(this.i);
    const m = rest.match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
    if (!m) { this.i++; return null; }
    this.i += m[0].length;
    const word = m[0].toLowerCase();
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null' || word === 'undefined' || word === 'nan' || word === 'infinity') return null;
    return m[0]; // unquoted bareword treated as string
  }
}

function parseLoose(src, limits) {
  if (src.length > limits.maxLength) return { ok: false, error: 'max length exceeded' };
  try {
    const p = new LooseParser(src, limits);
    return { ok: true, value: p.value() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function withinDepth(value, maxDepth) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (!v || typeof v !== 'object') continue;
    if (d > maxDepth) return false;
    for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
  return true;
}

export function parseJson(text, limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  const src = preferredSource(text).trim();
  if (!src || src.length > merged.maxLength) return undefined;
  try {
    const v = JSON.parse(src);
    if (withinDepth(v, merged.maxDepth)) return v;
  } catch { /* fall through to tolerant parse */ }
  const r = parseLoose(src, merged);
  return r.ok ? r.value : undefined;
}

export function extractJson(text, limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  const src = preferredSource(text);
  if (!src) return undefined;
  const objects = [];
  const arrays = [];
  for (let i = 0; i < src.length && objects.length + arrays.length < merged.maxCandidates; i++) {
    if (src[i] === '{' && looksLikeObjectStart(src, i)) objects.push(i);
    else if (src[i] === '[' && looksLikeArrayStart(src, i)) arrays.push(i);
  }
  // Prefer objects: plans and recon reports are objects. This avoids grabbing a
  // prose bracket like "see [this] format" before the real JSON object.
  for (const idx of [...objects, ...arrays]) {
    const r = parseLoose(src.slice(idx), merged);
    if (r.ok && r.value && typeof r.value === 'object') return r.value;
  }
  return undefined;
}

export function extractAllJson(text, limits = {}) {
  const merged = { ...DEFAULT_LIMITS, ...limits };
  const src = preferredSource(text);
  const out = [];
  const seen = new Set();
  let attempts = 0;
  for (let i = 0; i < src.length; i++) {
    const isObject = src[i] === '{' && looksLikeObjectStart(src, i);
    const isArray = src[i] === '[' && looksLikeArrayStart(src, i);
    if (!isObject && !isArray) continue;
    if (attempts++ >= 50) break;
    const r = parseLoose(src.slice(i), merged);
    if (r.ok && r.value && typeof r.value === 'object') {
      const key = JSON.stringify(r.value);
      if (!seen.has(key)) { seen.add(key); out.push(r.value); }
    }
  }
  return out;
}