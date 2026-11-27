import { AGENTS } from './agents.mjs';
import { chatStreamWithFallback, providerChain } from './llm.mjs';
import { extractJson } from './json.mjs';

export async function runScout({ message, provider, signal }) {
  let text = '';
  try {
    for await (const { delta, done } of chatStreamWithFallback({
      providers: providerChain(provider), system: AGENTS.scout.system,
      messages: [{ role: 'user', content: message }],
      maxTokens: AGENTS.scout.maxTokens, signal,
    })) { if (done) break; text += delta; }
  } catch (e) {
    // Cancellation must stop the run, not silently turn into a generic scout
    // report that lets the rest of the pipeline keep spending budget.
    if (e?.name === 'AbortError') throw e;
    return { intent: 'unknown', domain: 'unknown', ambiguities: [], suggestedTools: [] };
  }

  const parsed = extractJson(text);
  if (!parsed) return { intent: 'general', domain: 'general', ambiguities: [], suggestedTools: [] };
  return {
    intent: parsed.intent ?? 'general',
    domain: parsed.domain ?? 'general',
    ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
    suggestedTools: Array.isArray(parsed.suggestedTools) ? parsed.suggestedTools.filter((t) => AGENTS[t] || ['calculator', 'clock', 'remember', 'recall', 'storyboard', 'sd_generate'].includes(t)) : [],
  };
}
