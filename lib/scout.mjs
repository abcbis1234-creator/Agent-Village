import { chatStream } from './llm.mjs';

export const SCOUT_SYSTEM = `You are Scout, a reconnaissance agent in a multi-agent village.
Your job is read-only reconnaissance BEFORE any planning happens.
Given a user mission and any prior conversation history, return ONLY valid JSON with exactly this shape:
{
  "facts": ["string"],           // concrete facts established from the mission itself
  "ambiguities": ["string"],     // things that are unclear and need clarification
  "suggested_scope": "string",   // bounded scope the Planner should target
  "relevant_context": ["string"] // key terms or concepts worth investigating
}
Rules:
- Do not execute tools. You only observe.
- Do not invent facts. If the mission doesn't say it, mark it as ambiguity.
- Keep each fact under 100 chars.
- Max 6 facts, 4 ambiguities.
- Return ONLY JSON. No markdown fences. No prose.`;

export async function scoutRun({ message, history, memory, provider, maxTokens = 300, signal }) {
  const contextBlock = history.length
    ? `Prior conversation (most recent first):\n${history.slice(-4).map((m) => `${m.role}: ${m.content}`).join('\n')}\n`
    : '';
  const memoryBlock = memory
    ? `Relevant memory: ${JSON.stringify(await memory.search(message, { k: 5 }))}`
    : '(no memory store)';

  let text = '';
  for await (const { delta, done } of chatStream({
    provider,
    system: SCOUT_SYSTEM,
    messages: [
      { role: 'user', content: `${contextBlock}${memoryBlock}\n\nMission: ${message}` },
    ],
    maxTokens,
    signal,
  })) {
    if (done) break;
    text += delta;
  }

  return parseScout(text, message);
}

function parseScout(text, fallbackScope = '') {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) {
    return { facts: [], ambiguities: [], suggested_scope: '', relevant_context: [] };
  }
  try {
    const parsed = JSON.parse(match[0]);
    return {
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 6) : [],
      ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities.slice(0, 4) : [],
      suggested_scope: typeof parsed.suggested_scope === 'string' ? parsed.suggested_scope : '',
      relevant_context: Array.isArray(parsed.relevant_context) ? parsed.relevant_context.slice(0, 6) : [],
    };
  } catch {
    return { facts: [], ambiguities: [], suggested_scope: '', relevant_context: [] };
  }
}
