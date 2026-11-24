function evaluate(src) {
  const tokens = src.match(/\d+\.?\d*|[+\-*/()]/g) ?? [];
  if (tokens.length === 0) throw new Error('empty expression');
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => { if (tokens[i] !== t) throw new Error(`expected ${t}`); i++; };
  function expr() { let l = term(); while (peek() === '+' || peek() === '-') { const o = tokens[i++]; const r = term(); l = o === '+' ? l + r : l - r; } return l; }
  function term() { let l = factor(); while (peek() === '*' || peek() === '/') { const o = tokens[i++]; const r = factor(); l = o === '*' ? l * r : l / r; } return l; }
  function factor() {
    const t = tokens[i];
    if (t === '(') { i++; const v = expr(); eat(')'); return v; }
    if (t === '-') { i++; return -factor(); }
    if (t === '+') { i++; return factor(); }
    if (t !== undefined && /^\d/.test(t)) { i++; return parseFloat(t); }
    throw new Error(`unexpected token: ${t ?? 'end'}`);
  }
  const v = expr();
  if (i !== tokens.length) throw new Error('trailing input');
  if (!Number.isFinite(v)) throw new Error('result is not finite');
  return v;
}

export const TOOLS = {
  calculator: {
    name: 'calculator', risk: 'safe', description: 'Evaluate arithmetic.',
    run: ({ expression }) => {
      if (typeof expression !== 'string') throw new Error('expression must be a string');
      return evaluate(expression);
    },
  },
  clock: {
    name: 'clock', risk: 'safe', description: 'Return current ISO timestamp.',
    run: () => new Date().toISOString(),
  },
  remember: {
    name: 'remember', risk: 'safe', description: 'Save a fact to vector memory.',
    run: async ({ text }, { memory, user }) => {
      if (typeof text !== 'string' || !text.trim()) throw new Error('text required');
      const m = await memory.add(text.trim(), [], user);
      return `saved ${m.id.slice(0, 8)}`;
    },
  },
  recall: {
    name: 'recall', risk: 'safe', description: 'Search vector memory.',
    run: ({ query, k }, { memory, user }) => {
      const hits = memory.search(query ?? '', { k: k ?? 5, user });
      if (hits.length === 0) return 'no matches';
      return hits.map((h) => `[${h.mem.id.slice(0, 8)} score=${h.score.toFixed(2)}] ${h.mem.text}`).join('\n');
    },
  },
  sd_generate: {
    name: 'sd_generate', risk: 'guarded', description: 'Stable Diffusion image generation.',
    run: async ({ prompt, width = 512, height = 512 }) => {
      const url = process.env.SD_ENDPOINT;
      if (!url) throw new Error('SD_ENDPOINT not configured');
      const res = await fetch(`${url}/sdapi/v1/txt2img`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, width, height, steps: 20 }),
      });
      if (!res.ok) throw new Error(`sd ${res.status}`);
      const data = await res.json();
      const b64 = data.images?.[0];
      if (!b64) throw new Error('no image returned');
      return `data:image/png;base64,${b64}`;
    },
  },
  external_http: {
    name: 'external_http', risk: 'guarded',
    description: 'Fetch a URL from an operator-configured egress allowlist (default-deny).',
    // Defense in depth: the security gate already enforces the allowlist +
    // approval, but re-check here so the tool is safe even if called directly.
    run: async ({ url }, { signal } = {}) => {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('url must be http(s)');
      let host;
      try { host = new URL(url).hostname.toLowerCase(); } catch { throw new Error('invalid url'); }
      if (isPrivateHost(host)) throw new Error('private/loopback host blocked');
      const allow = (process.env.EXTERNAL_HTTP_ALLOWLIST ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (allow.length === 0) throw new Error('egress denied: no allowlist configured');
      const ok = allow.some((a) => host === a || host.endsWith(`.${a}`));
      if (!ok) throw new Error(`egress denied: ${host} not in allowlist`);
      const res = await fetch(url, { signal, redirect: 'error' });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = await res.text();
      return body.slice(0, 20000);
    },
  },
};

function isPrivateHost(host) {
  if (host === 'localhost' || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true; // link-local / cloud metadata
  if (/^0\./.test(host)) return true;
  return false;
}

export async function runTool(name, args, ctx) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return await tool.run(args ?? {}, ctx);
}