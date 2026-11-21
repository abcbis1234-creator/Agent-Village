import { AGENTS } from './agents.mjs';
import { runTool } from './tools.mjs';
import { Workflow } from './workflow.mjs';
import { Budget } from './budget.mjs';
import { ApprovalQueue } from './policy.mjs';
import { chatStream } from './llm.mjs';
import { scoutRun } from './scout.mjs';
import { synthesizerRun } from './synthesizer.mjs';
import { verifyRun } from './verifier.mjs';
import { Bus } from './bus.mjs';
import { VectorMemory } from './memory.mjs';

function parsePlan(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) return { steps: [] };
  try {
    const parsed = JSON.parse(match[0]);
    return { steps: Array.isArray(parsed.steps) ? parsed.steps.slice(0, 8) : [] };
  } catch {
    return { steps: [] };
  }
}

const KEYWORD_ROUTES = [
  ['calculator', ['calculate', 'compute', 'what is', 'math', 'percent', 'divide', 'multiply']],
  ['clock', ['time', 'clock', 'what time', 'date', 'today', 'now']],
  ['remember', ['remember', 'save', 'note that', "don't forget", 'dont forget']],
  ['recall', ['recall', 'what do you know', 'look up', 'search memory', 'memories']],
];

function planFromKeywords(message) {
  const lower = message.toLowerCase();
  const steps = [];
  const seen = new Set();
  for (const [tool, kws] of KEYWORD_ROUTES) {
    if (kws.some((k) => lower.includes(k)) && !seen.has(tool)) {
      steps.push({ tool, args: {} });
      seen.add(tool);
    }
  }
  if (steps.some((s) => s.tool === 'calculator')) {
    const m = message.match(/[-\d\s().+*/]{3,}/g);
    if (m) {
      const c = m.find((t) => /\d/.test(t) && /[+\-*/]/.test(t));
      if (c) {
        const calc = steps.find((s) => s.tool === 'calculator');
        if (calc) calc.args = { expression: c.trim() };
      }
    }
  }
  return { steps };
}

export function parsePlanExported(text) { return parsePlan(text); }

async function runPlanner({ message, provider, signal, budget, history, scoutResult }) {
  const scoutBlock = scoutResult
    ? `\nScout recon:\nFacts: ${scoutResult.facts.join('; ')}\nAmbiguities: ${scoutResult.ambiguities.join('; ')}\nSuggested scope: ${scoutResult.suggested_scope}\n`
    : '';
  let text = '';
  for await (const { delta, done } of chatStream({
    provider,
    system: AGENTS.planner.system,
    messages: [...history.slice(-6), { role: 'user', content: `${scoutBlock}Mission: ${message}` }],
    maxTokens: AGENTS.planner.maxTokens,
    signal,
  })) {
    if (done) break;
    text += delta;
    budget.spend('tokens', 1);
  }
  return { plan: parsePlan(text), raw: text };
}

export async function* orchestrate({
  message,
  provider,
  user = 'anon',
  store,
  memory,
  bus = new Bus(),
  budget = new Budget(),
  policy = new ApprovalQueue(),
  conversationId,
  runId,
  signal,
  onEvent,
  onCheckpoint,
}) {
  const emit = (evt) => {
    const record = store?.appendEvent ? store.appendEvent(runId, evt) : { ...evt };
    onEvent?.(record);
    return record;
  };

  yield emit({ type: 'start', runId, provider, user });

  const history = (store?.getConversation(conversationId)?.messages ?? []).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));

  /* Phase 1: Scout - reconnaissance before planning */
  yield emit({ type: 'phase', phase: 'scout', agentId: 'scout' });
  let scoutResult;
  try {
    scoutResult = await scoutRun({ message, provider, signal, budget, history, memory });
    yield emit({ type: 'scout_result', ...scoutResult });
  } catch (e) {
    yield emit({ type: 'error', where: 'scout', message: e.message });
    scoutResult = { facts: [], ambiguities: [], suggested_scope: '', relevant_context: [] };
  }

  /* Phase 2: Planner - decides plan with Scout context */
  yield emit({ type: 'phase', phase: 'plan', agentId: 'planner' });
  let plan;
  try {
    const r = await runPlanner({ message, provider, signal, budget, history, scoutResult });
    plan = r.plan;
    if (plan.steps.length === 0) plan = planFromKeywords(message);
    yield emit({ type: 'planner_raw', raw: r.raw, steps: plan.steps });
  } catch (e) {
    plan = planFromKeywords(message);
    yield emit({ type: 'error', where: 'planner', message: e.message });
    yield emit({ type: 'planner_raw', raw: '', steps: plan.steps });
  }

  /* Phase 3: Builder DAG - executes tool steps */
  yield emit({ type: 'phase', phase: 'execute', agentId: 'builder' });
  const nodes = plan.steps.map((step, i) => ({
    id: `tool${i}`,
    tool: step.tool,
    args: step.args ?? {},
    optional: true,
    requiresApproval: policy.riskOf(step.tool) === 'guarded',
    reason: `tool ${step.tool} is guarded`,
    run: async ({ signal }) => {
      _eventQueue.push({ type: 'tool_call', tool: step.tool, args: step.args ?? {} });
      budget.spend('toolCalls');
      try {
        const result = await runTool(step.tool, step.args, { memory, store, user, signal });
        _eventQueue.push({ type: 'tool_result', tool: step.tool, result: String(result) });
        return String(result);
      } catch (e) {
        _eventQueue.push({ type: 'tool_error', tool: step.tool, error: e.message });
        throw e;
      }
    },
  }));

  const _eventQueue = [];
  const wf = new Workflow({ name: `run-${runId}`, nodes, policy, budget, onEvent: (evt) => { _eventQueue.push(evt); } });
  const yield_emit = async function* () { while (_eventQueue.length) yield _eventQueue.shift(); };

  const results = {};
  let wfError = null;
  try {
    await wf.run({ onCheckpoint: (cp) => store?.saveCheckpoint?.(runId, 'tool-phase', cp) });
    for (const [k, v] of wf.results.entries()) results[k] = v;
  } catch (e) {
    wfError = e.message;
    yield emit({ type: 'error', where: 'builder', message: e.message });
  }
  for (const evt of _eventQueue) yield emit(evt);

  /* Phase 4: Verifier - deterministic check after Builder */
  yield emit({ type: 'phase', phase: 'verify', agentId: 'verifier' });
  let verifyResult;
  try {
    verifyResult = verifyRun({ toolResults: results, mission: message });
    yield emit({ type: 'verify_result', ...verifyResult });
  } catch (e) {
    yield emit({ type: 'error', where: 'verifier', message: e.message });
    verifyResult = { passed: false, checks: [] };
  }

  /* Phase 5: Synthesizer - merge tool results into brief */
  yield emit({ type: 'phase', phase: 'synthesize', agentId: 'synthesizer' });
  let synthesizeResult;
  try {
    synthesizeResult = await synthesizerRun({ message, toolResults: results, verifierResult: verifyResult, provider, signal, budget, memory });
    yield emit({ type: 'synthesize_result', ...synthesizeResult });
  } catch (e) {
    yield emit({ type: 'error', where: 'synthesizer', message: e.message });
    synthesizeResult = { summary: '', evidence_table: [], risks: [], recommendations: [] };
  }

  /* Phase 6: Reviewer - final answer */
  yield emit({ type: 'phase', phase: 'review', agentId: 'reviewer' });

  const toolReport = Object.entries(results).map(([id, v]) => `- ${id}: ${v}`).join('\n') || '(no tools ran)';
  const synthBlock = synthesizeResult
    ? `\nSynthesized brief:\nSummary: ${synthesizeResult.summary}\nEvidence:\n${synthesizeResult.evidence_table.map((e) => `- ${e.tool}: ${e.finding}`).join('\n')}\nRisks:\n${synthesizeResult.risks.join('\n')}`
    : '';

  let finalText = '';
  yield emit({ type: 'message_start', agentId: 'reviewer' });
  try {
    for await (const { delta, done } of chatStream({
      provider,
      system: AGENTS.reviewer.system,
      messages: [
        ...history.slice(-6),
        { role: 'user', content: `Mission: ${message}\n\nTool results:\n${toolReport}\n${synthBlock}\n\nPlanner error: ${wfError ?? 'none'}` },
      ],
      maxTokens: AGENTS.reviewer.maxTokens,
      signal,
    })) {
      if (done) break;
      finalText += delta;
      budget.spend('tokens', 1);
      yield emit({ type: 'chunk', agentId: 'reviewer', content: delta });
    }
  } catch (e) {
    yield emit({ type: 'error', where: 'reviewer', message: e.message });
  }

  yield emit({ type: 'message_end', agentId: 'reviewer', content: finalText });
  yield emit({ type: 'budget', snapshot: budget.snapshot() });
  yield emit({ type: 'done' });
}
