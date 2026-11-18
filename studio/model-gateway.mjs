/**
 * Server-side multi-provider model gateway.
 * API keys are read only from environment variables and never returned to clients.
 * Provider calls are explicit; there is no automatic paid-model fallback.
 */
const PROVIDERS = {
  ollama: {
    label: 'Ollama (local)',
    keyEnv: '',
    modelEnv: 'OLLAMA_MODEL',
    defaultModel: 'llama3.2',
    endpoint: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434/api/chat'
  },
  openai: {
    label: 'OpenAI / ChatGPT',
    keyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    defaultModel: '',
    endpoint: 'https://api.openai.com/v1/responses'
  },
  anthropic: {
    label: 'Anthropic / Claude',
    keyEnv: 'ANTHROPIC_API_KEY',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultModel: '',
    endpoint: 'https://api.anthropic.com/v1/messages'
  },
  gemini: {
    label: 'Google / Gemini',
    keyEnv: 'GEMINI_API_KEY',
    modelEnv: 'GEMINI_MODEL',
    defaultModel: '',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models'
  }
};

const MAX_PROMPT_CHARS = 12000;
const MAX_SYSTEM_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 45000;
const MAX_TIMEOUT_MS = 60000;
const DEFAULT_SYSTEM = 'You are a careful specialist agent. State uncertainty, distinguish facts from assumptions, and do not invent evidence.';

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 1000 || value > MAX_TIMEOUT_MS) throw new Error('timeoutMs must be an integer between 1000 and 60000');
  return value;
}

function providerConfig(id, env = process.env) {
  const definition = PROVIDERS[id];
  if (!definition) throw new Error('Unsupported model provider');
  return {
    id,
    label: definition.label,
    configured: id === 'ollama' ? true : Boolean(env[definition.keyEnv]),
    model: env[definition.modelEnv] || definition.defaultModel,
    key: definition.keyEnv ? (env[definition.keyEnv] || '') : '',
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
  if (config.id === 'ollama') {
    body = { model: config.model, stream: false, messages: [{ role: 'system', content: system || DEFAULT_SYSTEM }, { role: 'user', content: prompt }] };
  } else if (config.id === 'openai') {
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
  const text = config.id === 'ollama' ? (data.message?.content || '').trim() : config.id === 'openai' ? extractOpenAI(data) : config.id === 'anthropic' ? extractAnthropic(data) : extractGemini(data);
  if (!text) throw new Error(config.label + ' returned no text content');
  return text;
}

export async function generateWithModel({ provider, prompt, system = '', env = process.env, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const safePrompt = validateText(prompt, 'prompt', MAX_PROMPT_CHARS);
  const safeSystem = validateText(system, 'system', MAX_SYSTEM_CHARS, false);
  const config = providerConfig(provider, env);
  const safeTimeout = validateTimeout(timeoutMs);
  if (!config.model || typeof config.model !== 'string' || config.model.length > 120) throw new Error(config.label + ' model is not configured. Set ' + (PROVIDERS[provider].modelEnv || 'OLLAMA_MODEL') + ' to a valid model name.');
  if (config.id === 'ollama') {
    let localUrl;
    try { localUrl = new URL(config.endpoint); } catch { throw new Error('OLLAMA_HOST must be a valid local URL'); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(localUrl.hostname) || localUrl.protocol !== 'http:') throw new Error('Ollama endpoint must use localhost over HTTP; remote endpoints are disabled for safety');
  }
  if (!config.configured) throw new Error(config.label + ' is not configured. Add its API key to the server environment.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Model request timed out')), safeTimeout);
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

export async function compareModels({ prompt, providers = ['ollama'], system = '', env = process.env, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!Array.isArray(providers) || providers.length < 1 || providers.length > 4 || new Set(providers).size !== providers.length) {
    throw new Error('Choose between one and four distinct providers');
  }
  const results = await Promise.all(providers.map(async (provider) => {
    try { return { ok: true, ...(await generateWithModel({ provider, prompt, system, env, fetchImpl, timeoutMs })) }; }
    catch (error) { return { ok: false, provider, error: error.message }; }
  }));
  return { results, successful: results.filter((item) => item.ok).length, attempted: results.length };
}
