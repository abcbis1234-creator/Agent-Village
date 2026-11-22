import { AGENTS } from './agents.mjs';
import { chatStream } from './llm.mjs';
import { extractJson } from './json.mjs';

export async function runScout({ message, provider, signal }) {
  let text = '';
  try {
    for await (const { delta, done } of chatStream({
      provider, system: AGENTS.scout.system,
      messages: [{ role: 'user', content: message }],
      maxTokens: AGENTS.scout.maxTokens, signal,
    })) { if (done) break; text += delta; }
  } catch { return { intent: 'unknown', domain: 'unknown', ambiguities: [], suggestedTools: [] }; }

  const parsed = extractJson(text);
  if (!parsed) return { intent: 'general', domain: 'general', ambiguities: [], suggestedTools: [] };
  return {
    intent: parsed.intent ?? 'general',
    domain: parsed.domain ?? 'general',
    ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities : [],
    suggestedTools: Array.isArray(parsed.suggestedTools) ? parsed.suggestedTools.filter((t) => AGENTS[t] || ['calculator', 'clock', 'remember', 'recall', 'sd_generate'].includes(t)) : [],
  };
}
