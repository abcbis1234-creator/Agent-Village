import { chatStream } from './llm.mjs';

export const SYNTHESIZER_SYSTEM = `You are Synthesizer in a multi-agent village.
Your job is to merge multiple tool results into ONE coherent, structured brief.
You do NOT make decisions. You do NOT execute tools. You organize evidence.

Input: multiple tool results from different tools (calculator, clock, remember, recall, sd_generate), plus verification results.
Output: ONLY valid JSON with exactly this shape:
{
  "summary": "string",           // one sentence summary of what was found
  "evidence_table": [            // each tool result as a row
    { "tool": "string", "finding": "string", "confidence": "high|medium|low" }
  ],
  "risks": ["string"],           // what could go wrong or is uncertain
  "recommendations": ["string"]  // what to do next based on the evidence
}
Rules:
- Every evidence row must correspond to an actual tool result.
- Do not invent facts not present in the tool results.
- Mark confidence as "low" if the tool result is vague or the verifier flagged issues.
- Keep each finding under 200 chars.
- Max 8 evidence rows, 4 risks, 4 recommendations.
- Return ONLY JSON. No markdown fences. No prose.`;

export async function synthesizerRun({ message, toolResults, verifierResult, provider, maxTokens = 400, signal }) {
  const resultsBlock = Object.entries(toolResults ?? {})
    .map(([tool, result]) => `${tool}: ${result}`)
    .join('\n') || '(no tools ran)';

  const verdictBlock = verifierResult
    ? `\nVerification:\n${verifierResult.checks.map((c) => `- ${c.name}: ${c.pass ? 'PASS' : 'FAIL'} (${c.evidence})`).join('\n')}`
    : '\nVerification: not run';

  let text = '';
  for await (const { delta, done } of chatStream({
    provider,
    system: SYNTHESIZER_SYSTEM,
    messages: [
      { role: 'user', content: `Mission: ${message}\n\nTool Results:\n${resultsBlock}${verdictBlock}` },
    ],
    maxTokens,
    signal,
  })) {
    if (done) break;
    text += delta;
  }

  return parseSynthesizer(text, toolResults);
}

function parseSynthesizer(text, toolResults) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) {
    return fallbackSynthesize(toolResults);
  }
  try {
    const parsed = JSON.parse(match[0]);
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      evidence_table: Array.isArray(parsed.evidence_table)
        ? parsed.evidence_table.slice(0, 8)
        : Object.entries(toolResults ?? {}).map(([tool, result]) => ({ tool, finding: String(result).slice(0, 200), confidence: 'medium' })),
      risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 4) : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 4) : [],
    };
  } catch {
    return fallbackSynthesize(toolResults);
  }
}

function fallbackSynthesize(toolResults) {
  return {
    summary: `Collected results from ${Object.keys(toolResults ?? {}).length} tool(s).`,
    evidence_table: Object.entries(toolResults ?? {}).slice(0, 8).map(([tool, result]) => ({
      tool,
      finding: String(result).slice(0, 200),
      confidence: 'medium',
    })),
    risks: [],
    recommendations: [],
  };
}
