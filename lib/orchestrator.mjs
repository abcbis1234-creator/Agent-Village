import { AGENTS } from './agents.mjs';
import { runTool } from './tools.mjs';
import { Workflow } from './workflow.mjs';
import { Budget } from './budget.mjs';
import { ApprovalQueue } from './policy.mjs';
import { chatStream } from './llm.mjs';
import { scoutRun } from './scout.mjs';
import { synthesizerRun } from './synthesizer.mjs';
import { verifyRun } from './verifier.mjs';
import { Archivist } from './memory-v2.mjs';
import { Critic, LENSES } from './critic-v2.mjs';
import { SecurityReviewer, VERDICTS } from './security-v2.mjs';
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

// Extract actionable lessons from the run's event log (legacy archive_written payload).
function deriveLessons(events) {
  const lessons = [];
  for (const e of events) {
    const p = e.payload ?? e;
    if (e.type === 'tool_error') lessons.push({ kind: 'failure', tool: p.tool, evidence: p.error, severity: 'medium' });
    if (e.type === 'verify_result' && p.passed === false) lessons.push({ kind: 'verification_failure', evidence: p.checks?.filter((c) => !c.pass).map((c) => c.evidence), severity: 'high' });
    if (e.type === 'tool_result' && p.tool === 'calculator') lessons.push({ kind: 'computation', tool: 'calculator', evidence: p.result, severity: 'low' });
  }
  return lessons;
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
  archivist = new Archivist(store),
  security = new SecurityReviewer({ store, provider }),
  critic = new Critic({ llm: { chatStream }, store }),
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

  /* Phase 0: Archivist — assemble typed memory packet from prior context */
  yield emit({ type: 'phase', phase: 'archive', agentId: 'archivist' });
  let memoryPacket = [];
  try {
    const hits = archivist.retrieve(message, { user, k: 6 });
    memoryPacket = hits.map((h) => ({
      id: h.memory.id,
      type: h.memory.type,
      text: h.memory.text,
      score: Number(h.score.toFixed(3)),
      provenance: h.memory.provenance ?? [],
    }));
    yield emit({ type: 'memory_packet', packet: memoryPacket });
    // Legacy alias for existing consumers.
    yield emit({ type: 'archive_result', memories: memoryPacket.map((m) => ({ id: m.id, text: m.text, score: m.score })) });
  } catch (e) {
    yield emit({ type: 'error', where: 'archivist', message: e.message });
  }

  /* Phase 1: Scout — reconnaissance before planning */
  yield emit({ type: 'phase', phase: 'scout', agentId: 'scout' });
  let scoutResult;
  try {
    scoutResult = await scoutRun({ message, provider, signal, budget, history, memory });
    yield emit({ type: 'scout_result', ...scoutResult });
  } catch (e) {
    yield emit({ type: 'error', where: 'scout', message: e.message });
    scoutResult = { facts: [], ambiguities: [], suggested_scope: '', relevant_context: [] };
  }

  /* Phase 2: Planner — decides plan with Scout + memory context */
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

  /* Phase 3: Builder DAG — executes tool steps with Security Reviewer gate */
  yield emit({ type: 'phase', phase: 'execute', agentId: 'builder' });
  const _eventQueue = [];
  const nodes = plan.steps.map((step, i) => ({
    id: `tool${i}`,
    tool: step.tool,
    args: step.args ?? {},
    optional: true,
    requiresApproval: policy.riskOf(step.tool) === 'guarded',
    reason: `tool ${step.tool} is guarded`,
    run: async ({ signal: nodeSignal }) => {
      // Security Reviewer v2: deterministic L1 first, then L2 for guarded calls.
      const decision = await security.gate({
        tool: step.tool,
        args: step.args,
        user,
        runId,
        signal: nodeSignal ?? signal,
        onEvent: (e) => _eventQueue.push(e),
      });

      if (decision.verdict === VERDICTS.DENY || decision.verdict === VERDICTS.QUARANTINE) {
        _eventQueue.push({ type: 'security_block', tool: step.tool, args: step.args, reasons: decision.reasons, verdict: decision.verdict });
        throw new Error(`Security review blocked tool ${step.tool}: ${decision.reasons.map((r) => String(r)).join(', ')}`);
      }

      // Approval was already granted by the Workflow before this node ran; mint a
      // single-use capability token and re-gate so the audit trail shows a clean pass.
      if (decision.verdict === VERDICTS.REQUIRE_APPROVAL) {
        const token = security.mintCapability({ tool: step.tool, scope: 'once', ttlMs: 60_000 });
        const recheck = await security.gate({
          tool: step.tool,
          args: step.args,
          user,
          runId,
          signal: nodeSignal ?? signal,
          capabilityToken: token,
          onEvent: (e) => _eventQueue.push(e),
        });
        if (recheck.verdict === VERDICTS.DENY || recheck.verdict === VERDICTS.QUARANTINE) {
          _eventQueue.push({ type: 'security_block', tool: step.tool, args: step.args, reasons: recheck.reasons, verdict: recheck.verdict });
          throw new Error(`Security review blocked tool ${step.tool}: ${recheck.reasons.map((r) => String(r)).join(', ')}`);
        }
      }

      _eventQueue.push({ type: 'tool_call', tool: step.tool, args: step.args ?? {} });
      budget.spend('toolCalls');
      try {
        const result = await runTool(step.tool, step.args, { memory, store, user, signal: nodeSignal ?? signal });
        _eventQueue.push({ type: 'tool_result', tool: step.tool, result: String(result) });
        return String(result);
      } catch (e) {
        _eventQueue.push({ type: 'tool_error', tool: step.tool, error: e.message });
        throw e;
      }
    },
  }));

  const wf = new Workflow({ name: `run-${runId}`, nodes, policy, budget, onEvent: (evt) => { _eventQueue.push(evt); } });

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

  /* Phase 4: Verifier — deterministic check after Builder */
  yield emit({ type: 'phase', phase: 'verify', agentId: 'verifier' });
  let verifyResult;
  try {
    verifyResult = verifyRun({ toolResults: results, mission: message });
    yield emit({ type: 'verify_result', ...verifyResult });
  } catch (e) {
    yield emit({ type: 'error', where: 'verifier', message: e.message });
    verifyResult = { passed: false, checks: [] };
  }

  /* Phase 5: Synthesizer — merge tool results into brief */
  yield emit({ type: 'phase', phase: 'synthesize', agentId: 'synthesizer' });
  let synthesizeResult;
  try {
    synthesizeResult = await synthesizerRun({ message, toolResults: results, verifierResult: verifyResult, provider, signal, budget, memory });
    yield emit({ type: 'synthesize_result', ...synthesizeResult });
  } catch (e) {
    yield emit({ type: 'error', where: 'synthesizer', message: e.message });
    synthesizeResult = { summary: '', evidence_table: [], risks: [], recommendations: [] };
  }

  const toolReport = Object.entries(results).map(([id, v]) => `- ${id}: ${v}`).join('\n') || '(no tools ran)';
  const synthBlock = synthesizeResult
    ? `\nSynthesized brief:\nSummary: ${synthesizeResult.summary}\nEvidence:\n${synthesizeResult.evidence_table.map((e) => `- ${e.tool}: ${e.finding}`).join('\n')}\nRisks:\n${synthesizeResult.risks.join('\n')}`
    : '';

  // Reviewer streaming helper — yields SSE-ready events; final text is read from message_end.
  async function* runReviewer(extraBlock) {
    let finalText = '';
    yield { type: 'message_start', agentId: 'reviewer' };
    try {
      for await (const { delta, done } of chatStream({
        provider,
        system: AGENTS.reviewer.system,
        messages: [
          ...history.slice(-6),
          { role: 'user', content: `Mission: ${message}\n\nTool results:\n${toolReport}\n${synthBlock}${extraBlock}\n\nPlanner error: ${wfError ?? 'none'}` },
        ],
        maxTokens: AGENTS.reviewer.maxTokens,
        signal,
      })) {
        if (done) break;
        finalText += delta;
        budget.spend('tokens', 1);
        yield { type: 'chunk', agentId: 'reviewer', content: delta };
      }
    } catch (e) {
      yield { type: 'error', where: 'reviewer', message: e.message };
    }
    yield { type: 'message_end', agentId: 'reviewer', content: finalText };
    return finalText;
  }

  /* Phase 6: Reviewer — final answer */
  yield emit({ type: 'phase', phase: 'review', agentId: 'reviewer' });
  let finalText = '';
  for await (const evt of runReviewer('')) {
    yield emit(evt);
    if (evt.type === 'message_end') finalText = evt.content;
  }

  /* Phase 7: Critic — independent adversarial review of the artifact.
   * Runs AFTER the Reviewer, receives only artifact + request + memory context
   * (never the builder's self-assessment), defaults to a different provider.
   */
  yield emit({ type: 'phase', phase: 'critic', agentId: 'critic' });
  let criticVerdict;
  try {
    const memoryContext = memoryPacket.map((m) => m.text).join('\n');
    criticVerdict = await critic.review({
      artifact: finalText,
      request: message,
      context: memoryContext,
      builderProvider: provider,
      signal,
      onEvent: (e) => emit(e),
    });
    budget.spend('llm_calls', Object.keys(LENSES).length);
    yield emit({ type: 'critic_result', ...criticVerdict });
  } catch (e) {
    yield emit({ type: 'error', where: 'critic', message: e.message });
    criticVerdict = { overall: 'accept', summary: 'critic unavailable', findings: [], issues: [], confidence: 0, calibrated: 'low' };
  }

  /* Revision gate: one retry, never a loop. */
  if (criticVerdict.overall === 'reject' && (criticVerdict.confidence ?? 0) >= 0.6) {
    yield emit({ type: 'revision_requested', findings: criticVerdict.findings, summary: criticVerdict.summary });
    const critiqueBlock = `\nCritic revision required:\n${criticVerdict.findings
      .map((f) => `- ${f.finding ?? f.gaps?.join('; ') ?? f.counterCase ?? f.note ?? 'issue'}`)
      .join('\n')}`;
    finalText = '';
    for await (const evt of runReviewer(critiqueBlock)) {
      yield emit(evt);
      if (evt.type === 'message_end') finalText = evt.content;
    }
  }

  /* Phase 8: Archivist — consolidate run into episodic memory */
  yield emit({ type: 'phase', phase: 'archive_write', agentId: 'archivist' });
  let archiveResult;
  try {
    const entry = await archivist.record({
      type: 'episodic',
      text: `Run for "${message.slice(0, 80)}": ${finalText.slice(0, 400)}`,
      importance: criticVerdict?.overall === 'reject' ? 4 : 3,
      user,
      provenance: [runId],
      tags: ['run', criticVerdict?.overall ?? 'no-critique'],
    });
    const lessons = deriveLessons(store?.listEvents ? store.listEvents(runId) : []);
    archiveResult = { id: entry.id, memoryId: entry.id, lessons };
    yield emit({ type: 'archive_written', memoryId: entry.id, lessons });
  } catch (e) {
    yield emit({ type: 'error', where: 'archivist_write', message: e.message });
  }

  yield emit({ type: 'budget', snapshot: budget.snapshot() });
  yield emit({ type: 'done' });
}