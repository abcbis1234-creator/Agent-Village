function evaluate(src) {
  const tokens = String(src).match(/\d+\.?\d*|[+\-*/()]/g) ?? [];
  if (tokens.length === 0) throw new Error('empty expression');
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => { if (tokens[i] !== t) throw new Error(`expected ${t}, got ${tokens[i] ?? 'end'}`); i += 1; };
  function expr() {
    let l = term();
    while (peek() === '+' || peek() === '-') { const o = tokens[i]; i += 1; const r = term(); l = o === '+' ? l + r : l - r; }
    return l;
  }
  function term() {
    let l = factor();
    while (peek() === '*' || peek() === '/') { const o = tokens[i]; i += 1; const r = factor(); l = o === '*' ? l * r : l / r; }
    return l;
  }
  function factor() {
    const t = tokens[i];
    if (t === '(') { i += 1; const v = expr(); eat(')'); return v; }
    if (t === '-') { i += 1; return -factor(); }
    if (t === '+') { i += 1; return factor(); }
    if (t !== undefined && /^\d/.test(t)) { i += 1; return parseFloat(t); }
    throw new Error(`unexpected token: ${t ?? 'end'}`);
  }
  const v = expr();
  if (i !== tokens.length) throw new Error('trailing input');
  if (!Number.isFinite(v)) throw new Error('result is not finite');
  return v;
}

export const TOOLS = {
  calculator: {
    name: 'calculator',
    description: 'Evaluate arithmetic: numbers, + - * /, parentheses.',
    risk: 'safe',
    params: { expression: 'string' },
    run: ({ expression }) => {
      if (typeof expression !== 'string') throw new Error('expression must be a string');
      return evaluate(expression);
    },
  },
  clock: {
    name: 'clock',
    description: 'Current date and time in ISO 8601.',
    risk: 'safe',
    params: {},
    run: () => new Date().toISOString(),
  },
  remember: {
    name: 'remember',
    description: 'Save a fact to long-term vector memory.',
    risk: 'safe',
    params: { text: 'string', tags: 'string[]?' },
    run: async ({ text }, ctx) => {
      if (typeof text !== 'string' || !text.trim()) throw new Error('text is required');
      const m = await ctx.memory.add(text.trim(), ctx.tags ?? [], ctx.user);
      return `saved memory ${m.id.slice(0, 8)}`;
    },
  },
  recall: {
    name: 'recall',
    description: 'Search long-term memory by semantic similarity.',
    risk: 'safe',
    params: { query: 'string', k: 'number?' },
    run: ({ query, k }, ctx) => {
      const hits = ctx.memory.search(query ?? '', { k: k ?? 5, user: ctx.user });
      if (hits.length === 0) return 'no matches';
      return hits.map((h) => `[${h.mem.id.slice(0, 8)} score=${h.score.toFixed(2)}] ${h.mem.text}`).join('\n');
    },
  },
  sd_generate: {
    name: 'sd_generate',
    description: 'Generate an image via a Stable Diffusion endpoint (requires human approval).',
    risk: 'guarded',
    params: { prompt: 'string', width: 'number?', height: 'number?' },
    run: async ({ prompt, width = 512, height = 512 }) => {
      const url = process.env.SD_ENDPOINT;
      if (!url) throw new Error('SD_ENDPOINT not configured');
      const res = await fetch(`${url.replace(/\/+$/, '')}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, width, height, steps: 20 }),
      });
      if (!res.ok) throw new Error(`sd ${res.status}: ${await res.text().catch(() => '')}`);
      const data = await res.json();
      const b64 = data.images?.[0];
      if (!b64) throw new Error('no image returned by Stable Diffusion');
      return `data:image/png;base64,${b64}`;
    },
  },
};

export async function runTool(name, args, ctx) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return await tool.run(args ?? {}, ctx);
}
