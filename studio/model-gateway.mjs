/**
 * Server-side multi-provider model gateway.
 * API keys are read only from environment variables and never returned to clients.
 * Provider calls are explicit; there is no automatic paid-model fallback.
 */
const PROVIDERS = {
  openai: {
    label: 'OpenAI / ChatGPT',
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: 'gpt-6.2-astra',
    endpoint: 'https://api.openai.com/v1/responses'
  },
  anthropic: {
    label: 'Anthropic / Claude',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: 'claude-sonnet-5-5',
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  gemini: {
    label: 'Google / Gemini',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  }
};

const MAX_PROMPT_CHARS = 12000;
const MAX_SYSTEM_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 60000;

function providerConfig(id, env = process.env) {
  const definition = PROVIDERS[id];
  if (!definition) throw new Error('Unsupported model provider');
  return {
    id,
    label: definition.label,
    configured: Boolean(env[definition.keyEnv]),
    model: env[definition.modelEnv] || definition.defaultModel,
    key: env[definition.keyEnv] || '',
    endpoint: definition.endpoint
  };
}

export function listModelProviders(env = process.env) {
  return Object.keys(PROVIDERS).map((id) => {
    const { key, endpoint, ...publicConfig } = providerConfig(id, env);
    return publicConfig;
  });
}

function validateText(value, field, max, required = true) {
  if (typeof value !== 'string') {
    if (!required && value == null) return '';
    throw new Error(field + ' must be text');
  }
  const text = value.trim();
  if (required && !text) throw new Error(field + ' cannot be empty');
  if (text.length > max) throw new Error(field + ' exceeds ' + max + ' characters');
  return text;
}

function extractOpenAI(data) {
  if (typeof data.output_text === 'string') return data.output_text.trim();
  const texts = [];
  for (const item of data.output || []) {
    for (const part of item.content || []) if (part.type === 'output_text' && part.text) texts.push(part.text);
  }
  return texts.join('\n').trim();
}

function extractAnthropic(data) {
  return (data.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n').trim();
}

function extractGemini(data) {
  return (data.candidates?.[0]?.content?.parts || []).filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n').trim();
}

async function requestProvider(config, prompt, system, fetchImpl, signal) {
  let url = config.endpoint;
  let headers = { 'Content-Type': 'application/json' };
  let body;
  if (config.id === 'openai') {
    headers.Authorization = 'Bearer ' + config.key;
    body = { model: config.model, input: [{ role: 'system', content: system || 'You are a careful specialist agent. State uncertainty and do not invent evidence.' }, { role: 'user', content: prompt }], max_output_tokens: 1800 };
  } else if (config.id === 'anthropic') {
    headers['x-api-key'] = config.key;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: 1800, system: system || 'You are a careful specialist agent. State uncertainty and do not invent evidence.', messages: [{ role: 'user', content: prompt }] };
  } else {
    headers['x-goog-api-key'] = config.key;
    url += '/' + encodeURIComponent(config.model) + ':generateContent';
    body = { systemInstruction: { parts: [{ text: system || 'You are a careful specialist agent. State uncertainty and do not invent evidence.' }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 1800 } };
  }
  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const message = data.error?.message || data.message || ('Provider returned HTTP ' + response.status);
    throw new Error(config.label + ': ' + message.slice(0, 500));
  }
  const text = config.id === 'openai' ? extractOpenAI(data) : config.id === 'anthropic' ? extractAnthropic(data) : extractGemini(data);
  if (!text) throw new Error(config.label + ' returned no text content');
  return text;
}

export async function generateWithModel({ provider, prompt, system = '', env = process.env, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const safePrompt = validateText(prompt, 'prompt', MAX_PROMPT_CHARS);
  const safeSystem = validateText(system, 'system', MAX_SYSTEM_CHARS, false);
  const config = providerConfig(provider, env);
  if (!config.configured) throw new Error(config.label + ' is not configured. Add its API key to the server environment.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Model request timed out')), timeoutMs);
  try {
    const output = await requestProvider(config, safePrompt, safeSystem, fetchImpl, controller.signal);
    return { provider: config.id, providerLabel: config.label, model: config.model, text: output, generatedAt: new Date().toISOString() };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(config.label + ' request timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function compareModels({ prompt, providers = ['openai', 'anthropic', 'gemini'], system = '', env = process.env, fetchImpl = fetch } = {}) {
  if (!Array.isArray(providers) || providers.length < 1 || providers.length > 3 || new Set(providers).size !== providers.length) {
    throw new Error('Choose between one and three distinct providers');
  }
  const results = await Promise.all(providers.map(async (provider) => {
    try { return { ok: true, ...(await generateWithModel({ provider, prompt, system, env, fetchImpl })) }; }
    catch (error) { return { ok: false, provider, error: error.message }; }
  }));
  return { results, successful: results.filter((item) => item.ok).length, attempted: results.length };
}
