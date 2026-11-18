import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const mediaDir = join(root, 'media');
const dataDir = join(root, 'data');
const port = Number(process.env.PORT || 3000);

// Persistent memory: corrections and knowledge notes. This is NOT model training.
let feedbackStore = [];
let knowledgeStore = [];
function normalizeMission(value) { return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
async function loadStores() {
  try { await mkdir(dataDir, { recursive: true }); } catch { /* ignore */ }
  try { feedbackStore = JSON.parse(await readFile(join(dataDir, 'feedback.json'), 'utf8')); } catch { feedbackStore = []; }
  try { knowledgeStore = JSON.parse(await readFile(join(dataDir, 'knowledge.json'), 'utf8')); } catch { knowledgeStore = []; }
  if (!Array.isArray(feedbackStore)) feedbackStore = [];
  if (!Array.isArray(knowledgeStore)) knowledgeStore = [];
}
async function saveFeedback() { try { await mkdir(dataDir, { recursive: true }); await writeFile(join(dataDir, 'feedback.json'), JSON.stringify(feedbackStore, null, 2)); } catch { /* ignore */ } }
async function saveKnowledge() { try { await mkdir(dataDir, { recursive: true }); await writeFile(join(dataDir, 'knowledge.json'), JSON.stringify(knowledgeStore, null, 2)); } catch { /* ignore */ } }
await loadStores();

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"
};

const RUN_RATE_LIMIT = { windowMs: 60 * 1000, max: 30 };
const runRateState = new Map();
function logRequest(req, status) { console.log(`${new Date().toISOString()} ${req.method} ${req.url} -> ${status}`); }
function rateLimitRun(ip) {
  const now = Date.now();
  const entry = runRateState.get(ip) || { count: 0, reset: now + RUN_RATE_LIMIT.windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + RUN_RATE_LIMIT.windowMs; }
  entry.count += 1;
  runRateState.set(ip, entry);
  return entry.count <= RUN_RATE_LIMIT.max;
}

// Provider registry — credentials come ONLY from environment variables, never from code or browser.
// Stable Diffusion (Automatic1111 WebUI) is the default local image provider.
const providerConfig = {
  image: {
    provider: 'stable-diffusion',
    baseUrl: process.env.SD_BASE_URL || '',
    apiKey: process.env.SD_API_KEY || '',
    model: process.env.SD_MODEL || 'stable-diffusion',
    configured: Boolean(process.env.SD_BASE_URL),
    kind: 'image',
  },
  video: {
    provider: process.env.VIDEO_PROVIDER_NAME || 'none',
    baseUrl: process.env.VIDEO_BASE_URL || '',
    apiKey: process.env.VIDEO_PROVIDER_API_KEY || '',
    configured: Boolean(process.env.VIDEO_PROVIDER_API_KEY && process.env.VIDEO_BASE_URL),
    kind: 'video',
  },
};
const mediaApprovalState = new Map(); // id -> { approved, mission, kind, prompt, at }
const auditLog = [];
function audit(kind, detail) { auditLog.push({ at: new Date().toISOString(), kind, detail }); if (auditLog.length > 200) auditLog.shift(); }

async function ensureMediaDir() { try { await mkdir(mediaDir, { recursive: true }); } catch { /* ignore */ } }

async function generateImageStableDiffusion(prompt, options = {}) {
  const cfg = providerConfig.image;
  if (!cfg.baseUrl) throw new Error('Stable Diffusion not configured (set SD_BASE_URL)');
  const payload = {
    prompt,
    negative_prompt: options.negativePrompt || 'blurry, low quality, watermark, text, deformed',
    steps: options.steps || 30,
    width: options.width || 1024,
    height: options.height || 1024,
    cfg_scale: options.cfgScale || 7,
    sampler_name: options.sampler || 'DPM++ 2M Karras',
  };
  let response;
  try {
    response = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`Stable Diffusion request failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`Stable Diffusion error: HTTP ${response.status}`);
  const data = await response.json();
  const b64 = data.images && data.images[0];
  if (!b64) throw new Error('Stable Diffusion returned no image');
  await ensureMediaDir();
  const filename = `image-${Date.now()}.png`;
  await writeFile(join(mediaDir, filename), Buffer.from(b64, 'base64'));
  audit('image', `generated ${filename} from prompt: ${prompt.slice(0, 80)}`);
  return { provider: 'stable-diffusion', kind: 'image', prompt, status: 'generated', url: `/media/${filename}`, filename };
}

async function generateMedia(kind, prompt, options = {}) {
  const cfg = providerConfig[kind];
  if (!cfg) throw new Error(`unknown media kind: ${kind}`);
  if (!cfg.configured) throw new Error(`${kind} provider not configured`);
  if (kind === 'image') return generateImageStableDiffusion(prompt, options);
  // Video adapter placeholder: implement behind this boundary (e.g. AnimateDiff/ComfyUI/Runway).
  audit(kind, `generate requested: ${prompt.slice(0, 80)}`);
  return { provider: cfg.provider, kind, prompt, status: 'accepted', note: 'Video adapter not implemented. Add an adapter behind this boundary to produce real video.' };
}

// LLM provider (OpenAI-compatible). Works with Ollama, LM Studio, Groq, Gemini, OpenRouter, OpenAI, etc.
// Configured ONLY via environment variables; keys never reach the browser.
const LLM_PRESETS = {
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', label: 'Ollama (local, free)' },
  lmstudio: { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model', label: 'LM Studio (local)' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', label: 'Groq (free tier, key required)' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash', label: 'Google Gemini (free tier, key required)' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.1-8b-instruct:free', label: 'OpenRouter (free models, key required)' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', label: 'OpenAI (paid, key required)' },
};
const llmPresetName = process.env.LLM_PRESET || '';
const llmPreset = LLM_PRESETS[llmPresetName] || {};
const llmConfig = {
  preset: llmPresetName,
  baseUrl: process.env.LLM_BASE_URL || llmPreset.baseUrl || '',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || llmPreset.model || 'llama3.1',
  temperature: Number(process.env.LLM_TEMPERATURE || 0.4),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS || 30000),
  configured: Boolean(process.env.LLM_BASE_URL || llmPreset.baseUrl),
};

function clampText(value, max = 2000) { return typeof value === 'string' ? value.slice(0, max) : ''; }

async function callLLM(messages, options = {}) {
  if (!llmConfig.configured) throw new Error('LLM not configured (set LLM_BASE_URL)');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || llmConfig.timeoutMs);
  try {
    const payload = {
      model: options.model || llmConfig.model,
      temperature: options.temperature ?? llmConfig.temperature,
      messages,
    };
    if (options.json) payload.response_format = { type: 'json_object' };
    const response = await fetch(`${llmConfig.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(llmConfig.apiKey ? { Authorization: `Bearer ${llmConfig.apiKey}` } : {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM error: HTTP ${response.status}`);
    const data = await response.json();
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('LLM returned no content');
    return content;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('LLM request timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function matchKnowledge(mission) {
  const tokens = new Set(normalizeMission(mission).split(/\W+/).filter((w) => w.length > 3));
  return knowledgeStore.filter((k) => {
    const kt = normalizeMission(`${k.title} ${k.content}`).split(/\W+/).filter((w) => w.length > 3);
    return kt.some((w) => tokens.has(w));
  }).slice(0, 3);
}

async function runTaskWithLLM({ mission, rounds, key, info, roles, matchedKnowledge }) {
  const knowledgeText = matchedKnowledge.length ? matchedKnowledge.map((k) => `- ${k.title}: ${k.content}`).join('\n') : '(none)';
  const system = [
    'You are Agent Village, a bounded local AI workspace.',
    'Return ONLY valid JSON (no markdown fences) with exactly this shape:',
    '{"decision": string, "rationale": string, "dissent": string, "next_actions": string[], "confidence": "low"|"medium"|"high", "deliverable": {"title": string, "sections": [{"name": string, "content": string}]}, "reports": [{"role": string, "text": string}]}',
    'Rules: be concrete and useful; keep the deliverable bounded and reviewable; include a human review gate; never claim to have executed external actions; never include secrets, keys, or credentials.',
  ].join(' ');
  const user = [
    `Mission: ${mission}`,
    `Capability: ${info.name} (${key})`,
    `Rounds: ${rounds}`,
    `Reference knowledge:\n${knowledgeText}`,
    `Produce exactly ${roles.length} report entries, one per role in this order: ${roles.map((r) => r[1]).join(', ')}.`,
  ].join('\n');
  const raw = await callLLM([{ role: 'system', content: system }, { role: 'user', content: user }], { json: true });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('LLM returned invalid JSON'); }

  const reportEntries = Array.isArray(parsed.reports) ? parsed.reports : [];
  const reports = [];
  for (let round = 1; round <= rounds; round += 1) {
    roles.forEach(([roleKey, name, specialty], index) => {
      const text = (reportEntries[index] && reportEntries[index].text) || `${info.name} · ${name} · round ${round}: bounded contribution recorded.`;
      reports.push({ role: { key: roleKey, name, specialty }, round, source: `LLM · ${llmConfig.model}`, text: clampText(String(text), 900) });
    });
  }

  let sections = [];
  if (parsed.deliverable && Array.isArray(parsed.deliverable.sections)) {
    sections = parsed.deliverable.sections
      .filter((s) => s && s.name)
      .slice(0, 8)
      .map((s) => ({ name: clampText(String(s.name), 80), content: clampText(String(s.content), 1200) }));
  }
  if (!sections.length) sections = deliverable(mission, key, info).sections;
  if (matchedKnowledge.length) sections = [...sections, { name: 'Knowledge', content: matchedKnowledge.map((k) => `${k.title}: ${k.content}`).join(' | ') }];

  const validConfidence = ['low', 'medium', 'high'];
  const verdict = {
    decision: clampText(parsed.decision || `Proceed with a bounded first slice for "${mission}".`, 500),
    rationale: clampText(parsed.rationale || `The ${info.name} route keeps the work visible, bounded, and reviewable before expansion.`, 800),
    dissent: clampText(parsed.dissent || 'Do not expand scope until the first slice produces evidence.', 500),
    next_actions: Array.isArray(parsed.next_actions) && parsed.next_actions.length
      ? parsed.next_actions.slice(0, 8).map((a) => clampText(String(a), 200))
      : ['Review the deliverable.', 'Run the smallest end-to-end slice.', 'Test the riskiest assumption.'],
    confidence: validConfidence.includes(parsed.confidence) ? parsed.confidence : 'medium',
    calibrated: true,
  };

  const deliverableOut = { type: `${key}_brief`, title: clampText((parsed.deliverable && parsed.deliverable.title) || `${info.name} deliverable`, 200), sections };
  audit('llm', `generated ${key} deliverable via ${llmConfig.model}`);
  return { id: `mission-${Date.now()}`, mission, rounds, source: `LLM · ${llmConfig.model}`, capability: info, deliverable: deliverableOut, reports, knowledge: matchedKnowledge.map((k) => k.title), verdict };
}

const capabilities = [
  ['auto', 'Auto route', 'AR', 'Choose the best specialist path from the mission.', ['router', 'council', 'verifier']],
  ['generalist', 'Jack of All Trades', 'JA', 'Handle any open-ended task across reasoning, code, writing, and analysis.', ['general reasoning', 'multi-domain', 'bounded synthesis']],
  ['reasoning', 'Deep Reasoning', 'RE', 'Work through complex problems step by step with chain-of-thought and self-correction.', ['chain-of-thought', 'self-correction', 'proof sketch']],
  ['multimodal', 'Multimodal', 'MM', 'Reason across text, images, audio, and structured media in one brief.', ['image understanding', 'audio brief', 'cross-modal synthesis']],
  ['agentic', 'Agentic / Tool Use', 'AG', 'Plan and execute bounded tasks with tool calls, approval gates, and audit trails.', ['tool use', 'approval gate', 'audit trail']],
  ['long_context', 'Long Context', 'LC', 'Synthesize very large documents, codebases, and datasets into bounded deliverables.', ['document synthesis', 'codebase map', 'extraction']],
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
  ['agentic', ['agent', 'agentic', 'autonomous', 'tool use', 'tool-call', 'tool', 'workflow agent', 'execute task', 'run task', 'approval gates', 'audit trail']],
  ['long_context', ['summarize', 'document', 'codebase', 'large file', 'long text', 'extract from', 'read the file']],
  ['multimodal', ['image and text', 'multimodal', 'vision', 'photo', 'screenshot', 'diagram']],
  ['reasoning', ['reason', 'logic', 'proof', 'step by step', 'chain of thought', 'solve', 'theorem', 'puzzle']],
  ['webnovel', ['webnovel', 'novel', 'chapter', 'fiction', 'serial', 'story arc', 'characters']],
  ['video', ['video', 'film', 'shorts', 'short-form', 'short video', 'reel', 'tiktok', 'youtube', 'shot list', 'storyboard']],
  ['image', ['image', 'illustration', 'poster', 'logo', 'thumbnail', 'artwork']],
  ['audio', ['audio', 'voiceover', 'voice over', 'podcast', 'music', 'sound effect', 'narration']],
  ['website', ['website', 'web app', 'landing page', 'frontend', 'dashboard', 'site']],
  ['automation', ['automate', 'automation', 'workflow', 'trigger', 'recurring', 'bot']],
  ['code', ['code', 'build', 'program', 'script', 'app', 'api', 'bug', 'test', 'python', 'software']],
  ['research', ['research', 'find out', 'sources', 'evidence', 'investigate', 'latest']],
  ['writing', ['write', 'rewrite', 'draft', 'article', 'email', 'copy']],
  ['planning', ['plan', 'roadmap', 'schedule', 'steps', 'organize', 'launch', 'strategy']],
  ['analysis', ['analyze', 'analysis', 'trade-off', 'evaluate', 'should we', 'risk', 'decision']],
  ['data', ['data', 'dataset', 'csv', 'metrics', 'table', 'database', 'statistics', 'schema']],
  ['creative', ['idea', 'ideas', 'creative', 'name', 'concept', 'design', 'brainstorm', 'prompt']],
  ['generalist', ['cross-domain', 'open-ended', 'generalist', 'jack of all trades', 'anything', 'general task']],
];

function cleanMission(value) {
  if (typeof value !== 'string') throw new Error('mission must be a string');
  const mission = value.replace(/\s+/g, ' ').trim();
  if (!mission) throw new Error('mission cannot be empty');
  if (mission.length > 1200) throw new Error('mission must be 1200 characters or fewer');
  return mission;
}

function countKeyword(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'g');
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function routeMission(mission, requested = 'auto') {
  if (requested && requested !== 'auto' && capabilities.some((item) => item.key === requested)) return requested;
  const text = mission.toLowerCase();
  // Learned corrections take precedence over heuristics.
  const norm = normalizeMission(mission);
  const learned = feedbackStore.find((f) => normalizeMission(f.mission) === norm && capabilities.some((c) => c.key === f.expectedCapability));
  if (learned) return learned.expectedCapability;
  // Explicit generalist intent wins over single-keyword matches.
  if (['cross-domain', 'open-ended', 'jack of all trades', 'generalist', 'multi-domain'].some((p) => text.includes(p))) return 'generalist';
  let best = null;
  let bestScore = 0;
  for (const [key, words] of keywordRoutes) {
    let score = 0;
    for (const word of words) score += countKeyword(text, word);
    if (score > bestScore) { bestScore = score; best = key; }
  }
  return best || 'planning';
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
    local_ops: [['Workspace scope', 'Define the local directories and resources the worker may touch.'], ['Permission gate', 'List the operations requiring explicit human approval.'], ['Audit trail', 'Record every action, input, output, and approval for later review.']],
    generalist: [['Objective', mission], ['Domain scan', 'Identify the relevant domains (code, writing, analysis, research, planning) and the constraints in each.'], ['Bounded plan', 'Propose the smallest useful slice that produces a visible result and a review gate.'], ['Cross-domain synthesis', 'Combine insights from multiple domains into one coherent recommendation.'], ['Next actions', 'List review, testing, and expansion steps, ranked by risk and value.']],
    reasoning: [['Problem', mission], ['Chain of thought', 'Break the problem into explicit steps, stating assumptions at each step.'], ['Self-correction', 'Identify the weakest link and how to test or revise it.'], ['Proof sketch', 'Show why the conclusion follows, including edge cases and failure modes.'], ['Confidence', 'Rate the conclusion and state what evidence would raise or lower it.']],
    multimodal: [['Inputs', mission], ['Modality map', 'List the media types involved (text, image, audio, structured data) and how they relate.'], ['Cross-modal synthesis', 'Describe what each modality contributes and where they must agree.'], ['Render plan', 'Specify how the combined output should be presented and verified.'], ['Safety', 'Flag any content that needs human review before generation or publication.']],
    agentic: [['Goal', mission], ['Tool inventory', 'List the tools available and their permission boundaries.'], ['Plan', 'Trigger → validate → perform bounded work → request approval where needed → record outcome.'], ['Approval gates', 'Mark each step that requires human sign-off before execution.'], ['Audit trail', 'Record every action, input, output, and approval for later review.'], ['Failure path', 'Stop safely, preserve context, report the exact stage, and never silently repeat an external action.']],
    long_context: [['Source', mission], ['Scope', 'Define the documents, codebase, or dataset to be synthesized and the size boundary.'], ['Extraction', 'Pull out the key facts, entities, dependencies, and decisions.'], ['Synthesis', 'Combine extracted items into a bounded, citation-ready summary.'], ['Traceability', 'Map each conclusion back to its source location.'], ['Review gate', 'State what a human should verify before acting on the summary.']],
  };
  const sections = templates[key] || common.map(({ name, content }) => [name, content]);
  return { type: `${key}_brief`, title: `${info.name} deliverable`, sections: sections.map(([name, content]) => ({ name, content })) };
}

function report(role, key, round) {
  const mode = capabilities.find((item) => item.key === key)?.name || 'General';
  const endings = {
    nova: 'Frame the mission as a measurable outcome and keep the first slice narrow.',
    atlas: 'Decompose discovery, prototype, validation, and the review gate so the work remains reversible.',
    lyra: 'Name evidence gaps and test the riskiest assumption before polishing the surface.',
    forge: 'Build one happy path, one failure path, and an observable result with boundary validation.',
    echo: 'Challenge hidden scope, unverifiable claims, provider lock-in, and unsafe automation.',
    generalist: 'Scan the relevant domains, keep the first slice visible, and expand only after review.',
    reasoning: 'Work the problem step by step, state assumptions, and self-correct before concluding.',
    multimodal: 'Combine the media into one coherent brief and flag anything needing human review.',
    agentic: 'Plan the workflow with tool boundaries, approval gates, and an audit trail before execution.',
    long_context: 'Synthesize the source material and trace every conclusion back to its origin.',
  };
  return `${mode} route / round ${round}: ${endings[role]}`;
}

async function runTask(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid request body');
  const mission = cleanMission(body.mission);
  const rounds = Math.max(1, Math.min(3, Number.isInteger(body.rounds) ? body.rounds : 2));
  const key = routeMission(mission, body.capability);
  const info = capabilities.find((item) => item.key === key) || capabilities[4];
  const roles = [['nova', 'Nova', 'Planning'], ['atlas', 'Atlas', 'Architecture'], ['lyra', 'Lyra', 'Research'], ['forge', 'Forge', 'Build'], ['echo', 'Echo', 'Critique']];
  const matchedKnowledge = matchKnowledge(mission);
  if (llmConfig.configured) {
    try {
      return await runTaskWithLLM({ mission, rounds, key, info, roles, matchedKnowledge });
    } catch (error) {
      audit('llm', `fallback to demo: ${error.message}`);
    }
  }
  const reports = [];
  for (let round = 1; round <= rounds; round += 1) for (const [role, name, specialty] of roles) reports.push({ role: { key: role, name, specialty }, round, source: 'MANAGED LOCAL DEMO', text: report(role, key, round) });
  const decisionTemplates = {
    webnovel: `Start a serialized fiction package for "${mission}": world bible, cast, arc, and chapter one beat sheet.`,
    video: `Create a production-ready video brief for "${mission}": shots, camera movement, sound, and delivery format.`,
    website: `Define a buildable website slice for "${mission}" with routes, components, and acceptance criteria.`,
    generalist: `Handle "${mission}" as a cross-domain jack-of-all-trades task: scan domains, propose a bounded slice, and synthesize a recommendation.`,
    reasoning: `Work through "${mission}" step by step with chain-of-thought, self-correction, and a proof sketch.`,
    multimodal: `Combine the media in "${mission}" into one coherent cross-modal brief with a safety review gate.`,
    agentic: `Plan "${mission}" with tool boundaries, approval gates, and an audit trail before any execution.`,
    long_context: `Synthesize "${mission}" from the source material with traceable citations and a review gate.`,
  };
  const decision = decisionTemplates[key] || `Proceed with a bounded first slice for "${mission}".`;
  const confidenceLevels = { generalist: 'high', reasoning: 'high', multimodal: 'medium', agentic: 'medium', long_context: 'medium' };
  const del = deliverable(mission, key, info);
  if (matchedKnowledge.length) del.sections = [...del.sections, { name: 'Knowledge', content: matchedKnowledge.map((k) => `${k.title}: ${k.content}`).join(' | ') }];
  return { id: `mission-${Date.now()}`, mission, rounds, source: 'MANAGED LOCAL DEMO', capability: info, deliverable: del, reports, knowledge: matchedKnowledge.map((k) => k.title), verdict: { decision, rationale: `The ${info.name} route keeps the work visible, bounded, and reviewable before expansion.`, dissent: 'Do not add providers or autonomous actions until the first slice produces evidence.', next_actions: ['Review the proposed deliverable.', 'Run the smallest end-to-end slice.', 'Test the riskiest assumption.', 'Increase autonomy only after review.'], confidence: confidenceLevels[key] || 'medium', calibrated: true } };
}

const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
function send(res, status, body, type = 'application/json; charset=utf-8') { const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': data.length }); res.end(data); }
function serveFrom(baseDir, pathname, res) { const safe = pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''); if (safe.includes('..')) return send(res, 403, { error: 'forbidden' }); const file = resolve(baseDir, safe); if (file !== baseDir && !file.startsWith(baseDir + sep)) return send(res, 403, { error: 'forbidden' }); return stat(file).then((st) => { if (!st.isFile()) return send(res, 404, { error: 'not_found' }); return readFile(file); }).then((data) => send(res, 200, data, contentTypes[extname(file)] || 'application/octet-stream')).catch(() => send(res, 404, { error: 'not_found' })); }
function staticFile(pathname, res) { return serveFrom(publicDir, pathname, res); }

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.socket.remoteAddress || 'unknown';
  if (req.method === 'GET' && url.pathname === '/api/health') { logRequest(req, 200); return send(res, 200, { ok: true, mode: 'MANAGED LOCAL DEMO', capabilities: capabilities.length }); }
  if (req.method === 'GET' && url.pathname === '/api/capabilities') { logRequest(req, 200); return send(res, 200, { source: 'MANAGED LOCAL DEMO', capabilities }); }
  if (req.method === 'GET' && url.pathname === '/api/providers') { logRequest(req, 200); return send(res, 200, { source: 'MANAGED LOCAL DEMO', providers: [...Object.entries(providerConfig).map(([kind, cfg]) => ({ kind, provider: cfg.provider, configured: cfg.configured })), { kind: 'llm', provider: llmConfig.model, preset: llmConfig.preset || null, configured: llmConfig.configured }] }); }
  if (req.method === 'GET' && url.pathname === '/api/llm/presets') { logRequest(req, 200); return send(res, 200, { source: 'MANAGED LOCAL DEMO', active: llmConfig.preset || null, configured: llmConfig.configured, presets: Object.entries(LLM_PRESETS).map(([name, p]) => ({ name, label: p.label, baseUrl: p.baseUrl, model: p.model })) }); }
  if (req.method === 'GET' && url.pathname === '/api/feedback') { logRequest(req, 200); return send(res, 200, { source: 'MANAGED LOCAL DEMO', note: 'Corrections, not model training.', feedback: feedbackStore.slice(-50) }); }
  if (req.method === 'POST' && url.pathname === '/api/feedback') {
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('request body is too large'); }
      const body = JSON.parse(raw || '{}');
      const mission = cleanMission(body.mission);
      const expectedCapability = body.expectedCapability;
      if (!expectedCapability || expectedCapability === 'auto' || !capabilities.some((c) => c.key === expectedCapability)) throw new Error('expectedCapability must be a specific capability key');
      const entry = { id: `fb-${Date.now()}`, mission, expectedCapability, note: typeof body.note === 'string' ? body.note.slice(0, 300) : '', at: new Date().toISOString() };
      feedbackStore.push(entry);
      if (feedbackStore.length > 500) feedbackStore = feedbackStore.slice(-500);
      await saveFeedback();
      logRequest(req, 200);
      return send(res, 200, { ok: true, learned: entry });
    } catch (error) { logRequest(req, 400); return send(res, 400, { error: error.message || 'request failed' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/knowledge') { logRequest(req, 200); return send(res, 200, { source: 'MANAGED LOCAL DEMO', note: 'Stored notes, retrieved by keyword. Not model training.', knowledge: knowledgeStore.slice(-50) }); }
  if (req.method === 'POST' && url.pathname === '/api/knowledge') {
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('request body is too large'); }
      const body = JSON.parse(raw || '{}');
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!title) throw new Error('title is required');
      if (!content) throw new Error('content is required');
      if (title.length > 200) throw new Error('title must be 200 characters or fewer');
      if (content.length > 2000) throw new Error('content must be 2000 characters or fewer');
      const entry = { id: `kn-${Date.now()}`, title, content, at: new Date().toISOString() };
      knowledgeStore.push(entry);
      if (knowledgeStore.length > 500) knowledgeStore = knowledgeStore.slice(-500);
      await saveKnowledge();
      logRequest(req, 200);
      return send(res, 200, { ok: true, entry });
    } catch (error) { logRequest(req, 400); return send(res, 400, { error: error.message || 'request failed' }); }
  }
  if (req.method === 'GET' && url.pathname === '/api/agent-contract') { logRequest(req, 200); return send(res, 200, { version: '1.0', project: 'agent-village', purpose: 'bounded contribution contract for external AI agents', endpoints: { capabilities: 'GET /api/capabilities', run: 'POST /api/run', providers: 'GET /api/providers', media: 'POST /api/media/generate', approve: 'POST /api/media/approve', feedback: 'GET/POST /api/feedback', knowledge: 'GET/POST /api/knowledge' }, run_input: { mission: 'string, max 1200 chars', capability: 'optional capability key or auto', rounds: 'optional integer 1-3' }, return_shape: ['capability', 'deliverable', 'reports', 'verdict'], contribution_policy: ['propose changes as structured deliverables or patches', 'never request or return browser-side secrets', 'require human review before publish or consequential external action'], collaboration: { preferred: 'canonical Git branch or reviewed pull request', alternative: 'server-side adapter that implements the same contract' } }); }
  if (req.method === 'GET' && url.pathname === '/manus-routes.json') { logRequest(req, 200); return staticFile('/manus-routes.json', res); }
  if (req.method === 'POST' && url.pathname === '/api/run') {
    if (!rateLimitRun(ip)) { logRequest(req, 429); return send(res, 429, { error: 'rate limit exceeded', retry_after: Math.ceil(RUN_RATE_LIMIT.windowMs / 1000) }); }
    try { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('request body is too large'); } const result = await runTask(JSON.parse(raw || '{}')); logRequest(req, 200); return send(res, 200, result); }
    catch (error) { logRequest(req, 400); return send(res, 400, { error: error.message || 'request failed' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/media/generate') {
    if (!rateLimitRun(ip)) { logRequest(req, 429); return send(res, 429, { error: 'rate limit exceeded', retry_after: Math.ceil(RUN_RATE_LIMIT.windowMs / 1000) }); }
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('request body is too large'); }
      const body = JSON.parse(raw || '{}');
      const kind = body.kind;
      const prompt = body.prompt;
      if (!kind || !prompt || typeof prompt !== 'string') throw new Error('kind and prompt are required');
      if (!providerConfig[kind]) throw new Error('unknown media kind');
      if (!providerConfig[kind].configured) { logRequest(req, 400); return send(res, 400, { error: `${kind} provider not configured`, configured: false }); }
      if (!body.approved) {
        const id = `media-${Date.now()}`;
        mediaApprovalState.set(id, { approved: false, mission: body.mission || '', kind, prompt, at: new Date().toISOString() });
        if (mediaApprovalState.size > 100) { const oldest = mediaApprovalState.keys().next().value; mediaApprovalState.delete(oldest); }
        logRequest(req, 202);
        return send(res, 202, { error: 'approval required', id, kind, prompt, note: 'Call POST /api/media/approve with this id to authorize generation.' });
      }
      const entry = mediaApprovalState.get(body.id);
      if (!entry || !entry.approved || entry.kind !== kind || entry.prompt !== prompt) throw new Error('no valid approval for this generation');
      const result = await generateMedia(kind, prompt, body.options || {});
      entry.approved = false; // one-time use
      logRequest(req, 200);
      return send(res, 200, result);
    } catch (error) { logRequest(req, 400); return send(res, 400, { error: error.message || 'request failed' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/media/approve') {
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('request body is too large'); }
      const body = JSON.parse(raw || '{}');
      const entry = mediaApprovalState.get(body.id);
      if (!entry) throw new Error('unknown approval id');
      entry.approved = true;
      logRequest(req, 200);
      return send(res, 200, { approved: true, id: body.id, kind: entry.kind, prompt: entry.prompt });
    } catch (error) { logRequest(req, 400); return send(res, 400, { error: error.message || 'request failed' }); }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) { logRequest(req, 200); return serveFrom(mediaDir, url.pathname.slice('/media'.length), res); }
  if (req.method === 'GET') { return staticFile(url.pathname, res); }
  logRequest(req, 404);
  return send(res, 404, { error: 'not_found' });
}

const server = createServer(handleRequest);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Agent Village received ${signal}, shutting down gracefully…`);
  server.close(() => { console.log('Agent Village closed.'); process.exit(0); });
  setTimeout(() => { console.log('Forced shutdown after timeout.'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  server.listen(port, '0.0.0.0', () => console.log(`Agent Village listening on port ${port}`));
}

export { server, port, publicDir, mediaDir, dataDir, runTask, capabilities, cleanMission, RUN_RATE_LIMIT, runRateState, providerConfig, llmConfig, LLM_PRESETS, mediaApprovalState, auditLog, generateMedia, generateImageStableDiffusion, feedbackStore, knowledgeStore, loadStores, saveFeedback, saveKnowledge, callLLM, runTaskWithLLM, matchKnowledge };
