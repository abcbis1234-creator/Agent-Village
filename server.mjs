import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);

const capabilities = [
  ['auto', 'Auto route', 'AR', 'Choose the best specialist path from the mission.', ['router', 'council', 'verifier']],
  ['research', 'Research', 'RS', 'Frame questions, surface evidence gaps, and compare options.', ['question map', 'evidence gaps', 'source plan']],
  ['code', 'Code & build', 'CB', 'Turn a software goal into architecture, tests, and a safe build slice.', ['architecture', 'test plan', 'sandbox boundary']],
  ['writing', 'Writing', 'WR', 'Shape a brief, article, script, product copy, or clear explanation.', ['outline', 'tone pass', 'editor']],
  ['planning', 'Planning', 'PL', 'Break a goal into milestones, dependencies, owners, and review gates.', ['milestones', 'dependencies', 'review gates']],
  ['analysis', 'Analysis', 'AN', 'Compare trade-offs, identify assumptions, and make a calibrated recommendation.', ['criteria', 'trade-offs', 'confidence']],
  ['calculator', 'Calculator', 'CA', 'Evaluate a safe arithmetic expression without executing code.', ['AST calculator', 'unit check', 'result']],
  ['data', 'Data thinking', 'DT', 'Define metrics, schemas, tables, dashboards, and validation steps.', ['schema', 'metrics', 'quality checks']],
  ['creative', 'Creative studio', 'CS', 'Generate concepts, names, prompts, story beats, and variations.', ['ideation', 'variations', 'selection']],
  ['webnovel', 'Webnovel studio', 'WN', 'Develop a serialized novel with premise, cast, arcs, chapter beats, and publication rhythm.', ['world bible', 'chapter outline', 'continuity']],
  ['video', 'AI video studio', 'VD', 'Turn an idea into a production-ready video brief with shots, camera, sound, and delivery specs.', ['storyboard', 'shot list', 'audio plan']],
  ['image', 'Image studio', 'IM', 'Create a safe image brief with subject, composition, palette, references, and variants.', ['prompt pack', 'composition', 'variants']],
  ['audio', 'Audio studio', 'AU', 'Plan narration, dialogue, music, or sound effects with timing and voice direction.', ['script', 'voice brief', 'mix notes']],
  ['website', 'Web builder', 'WB', 'Translate a product idea into routes, components, data boundaries, and an implementation plan.', ['routes', 'components', 'acceptance']],
  ['automation', 'Automation lab', 'AT', 'Design a trigger, workflow, approval gate, and audit trail for recurring work.', ['trigger', 'workflow', 'guardrails']],
  ['local_ops', 'Local Ops', 'LO', 'Prepare a safe local execution brief for a future Apex worker.', ['workspace scope', 'permission gate', 'audit trail']],
].map(([key, name, icon, description, tools]) => ({ key, name, icon, description, tools }));

const keywordRoutes = [
  ['calculator', ['calculate', 'compute', 'what is', 'math', 'percent', 'divide', 'multiply']],
  ['webnovel', ['webnovel', 'novel', 'chapter', 'fiction', 'serial', 'story arc', 'characters']],
  ['video', ['video', 'film', 'short', 'reel', 'tiktok', 'youtube', 'shot list', 'storyboard']],
  ['image', ['image', 'illustration', 'poster', 'logo', 'thumbnail', 'artwork']],
  ['audio', ['audio', 'voiceover', 'voice over', 'podcast', 'music', 'sound effect', 'narration']],
  ['website', ['website', 'web app', 'landing page', 'frontend', 'dashboard', 'site']],
  ['automation', ['automate', 'automation', 'workflow', 'trigger', 'recurring', 'bot']],
  ['code', ['code', 'build', 'program', 'script', 'app', 'api', 'bug', 'test', 'python', 'software']],
  ['research', ['research', 'find out', 'sources', 'evidence', 'investigate', 'latest']],
  ['writing', ['write', 'rewrite', 'draft', 'article', 'email', 'copy']],
  ['planning', ['plan', 'roadmap', 'schedule', 'steps', 'organize', 'launch', 'strategy']],
  ['analysis', ['analyze', 'analysis', 'trade-off', 'evaluate', 'should we', 'risk', 'decision']],
  ['data', ['data', 'dataset', 'csv', 'metrics', 'table', 'database', 'statistics']],
  ['creative', ['idea', 'ideas', 'creative', 'name', 'concept', 'design', 'brainstorm', 'prompt']],
];

function cleanMission(value) {
  if (typeof value !== 'string') throw new Error('mission must be a string');
  const mission = value.replace(/\s+/g, ' ').trim();
  if (!mission) throw new Error('mission cannot be empty');
  if (mission.length > 1200) throw new Error('mission must be 1200 characters or fewer');
  return mission;
}

function routeMission(mission, requested = 'auto') {
  if (requested && requested !== 'auto' && capabilities.some((item) => item.key === requested)) return requested;
  const text = mission.toLowerCase();
  return keywordRoutes.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || 'planning';
}

function deliverable(mission, key, info) {
  const common = [{ name: 'Goal', content: mission }, { name: 'First deliverable', content: 'A bounded first slice with a visible result and a review gate.' }, { name: 'Risks', content: 'List the highest-risk assumption and the cheapest way to test it.' }];
  const templates = {
    webnovel: [['Premise', `A serialized story built around: ${mission}`], ['World bible', 'Define the rules of the world, the pressure created by them, and one mystery that can sustain a season.'], ['Core cast', 'Protagonist with a concrete want; rival with a defensible worldview; ally with a cost; antagonist with a system-level advantage.'], ['Season arc', 'Inciting disruption → first irreversible choice → midpoint revelation → public consequence → earned cliffhanger.'], ['Chapter one beats', 'Cold open, ordinary problem, strange signal, first choice, consequence, closing question.']],
    video: [['Concept', mission], ['Format', 'Choose platform, aspect ratio, approximate duration, audience, and whether generated audio is required.'], ['Shot 1', 'Opening frame, visible subject action, camera movement, sound, and the information delivered in the first two seconds.'], ['Shot 2', 'Escalation or demonstration with a clear visual result and a controlled transition.'], ['Ending', 'Resolve the central promise, hold the final framing, and specify title, caption, or call to action.'], ['Generation handoff', 'Ready for a server-side video provider; no browser-side keys or hidden model claims.']],
    image: [['Subject', mission], ['Composition', 'Specify framing, focal point, perspective, negative space, and intended crop.'], ['Style and light', 'Specify materials, palette, atmosphere, lighting direction, and visual references.'], ['Variants', 'Prepare three purposeful variations: hero, close detail, and alternate composition.']],
    audio: [['Purpose', mission], ['Script', 'Write exact spoken words separately from delivery style, pronunciation, language, and accent.'], ['Sound', 'Specify music, ambience, action effects, space, timing, and what must remain intelligible.'], ['Mix notes', 'Keep dialogue clear, preserve action cues, and verify rendered duration and tail.']],
    website: [['Product slice', mission], ['Routes', 'Home, primary workflow, detail view, and a clear empty/error state.'], ['Components', 'Navigation, task composer, status surface, result panel, history, and settings boundary.'], ['Acceptance', 'A user can complete the core task, understand what happened, and recover from failure without hidden state.']],
    automation: [['Trigger', mission], ['Workflow', 'Trigger → validate → perform bounded work → request approval where needed → record outcome.'], ['Guardrails', 'Idempotency, timeout, retry ceiling, secret handling, human approval, and audit record.'], ['Failure path', 'Stop safely, preserve context, report the exact stage, and never silently repeat an external action.']],
  };
  const sections = templates[key] || common.map(({ name, content }) => [name, content]);
  return { type: `${key}_brief`, title: `${info.name} deliverable`, sections: sections.map(([name, content]) => ({ name, content })) };
}

function report(role, mission, key, round) {
  const mode = capabilities.find((item) => item.key === key)?.name || 'General';
  const endings = {
    nova: `Frame ${mission} as a measurable outcome and keep the first slice narrow.`,
    atlas: 'Decompose discovery, prototype, validation, and the review gate so the work remains reversible.',
    lyra: 'Name evidence gaps and test the riskiest assumption before polishing the surface.',
    forge: 'Build one happy path, one failure path, and an observable result with boundary validation.',
    echo: 'Challenge hidden scope, unverifiable claims, provider lock-in, and unsafe automation.',
  };
  return `${mode} route / round ${round}: ${endings[role]}`;
}

async function runTask(body) {
  const mission = cleanMission(body.mission);
  const rounds = Math.max(1, Math.min(3, Number.isInteger(body.rounds) ? body.rounds : 2));
  const key = routeMission(mission, body.capability);
  const info = capabilities.find((item) => item.key === key) || capabilities[4];
  const roles = [['nova', 'Nova', 'Planning'], ['atlas', 'Atlas', 'Architecture'], ['lyra', 'Lyra', 'Research'], ['forge', 'Forge', 'Build'], ['echo', 'Echo', 'Critique']];
  const reports = [];
  for (let round = 1; round <= rounds; round += 1) for (const [role, name, specialty] of roles) reports.push({ role: { key: role, name, specialty }, round, source: 'MANAGED LOCAL DEMO', text: report(role, mission, key, round) });
  const decision = key === 'webnovel' ? `Start a serialized fiction package for ${mission}: world bible, cast, arc, and chapter one beat sheet.` : key === 'video' ? `Create a production-ready video brief for ${mission}: shots, camera movement, sound, and delivery format.` : key === 'website' ? `Define a buildable website slice for ${mission} with routes, components, and acceptance criteria.` : `Proceed with a bounded first slice for ${mission}.`;
  return { id: `mission-${Date.now()}`, mission, rounds, source: 'MANAGED LOCAL DEMO', capability: info, deliverable: deliverable(mission, key, info), reports, verdict: { decision, rationale: `The ${info.name} route keeps the work visible, bounded, and reviewable before expansion.`, dissent: 'Do not add providers or autonomous actions until the first slice produces evidence.', next_actions: ['Review the proposed deliverable.', 'Run the smallest end-to-end slice.', 'Test the riskiest assumption.', 'Increase autonomy only after review.'], confidence: 'calibrated' } };
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function send(res, status, body, type = 'application/json; charset=utf-8') { const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(status, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(data); }
function staticFile(pathname, res) { const safe = normalize(pathname).replace(/^\.{2,}/, ''); const file = join(publicDir, safe === '/' ? 'index.html' : safe); if (!file.startsWith(publicDir)) return send(res, 403, { error: 'forbidden' }); return readFile(file).then((data) => send(res, 200, data, contentTypes[extname(file)] || 'application/octet-stream')).catch(() => send(res, 404, { error: 'not_found' })); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, mode: 'MANAGED LOCAL DEMO', capabilities: capabilities.length });
  if (req.method === 'GET' && url.pathname === '/api/capabilities') return send(res, 200, { source: 'MANAGED LOCAL DEMO', capabilities });
  if (req.method === 'GET' && url.pathname === '/manus-routes.json') return staticFile('/manus-routes.json', res);
  if (req.method === 'POST' && url.pathname === '/api/run') {
    try { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('request body is too large'); } return send(res, 200, await runTask(JSON.parse(raw || '{}'))); }
    catch (error) { return send(res, 400, { error: error.message || 'request failed' }); }
  }
  if (req.method === 'GET') return staticFile(url.pathname, res);
  return send(res, 404, { error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => console.log(`Agent Village listening on port ${port}`));
