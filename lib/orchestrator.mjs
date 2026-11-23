import { AGENTS } from './agents.mjs';
import { runTool } from './tools.mjs';
import { chatStream, chatStreamWithFallback, listProviders } from './llm.mjs';
import { extractJson } from './json.mjs';
import { VectorMemory } from './memory.mjs';
import { Archivist } from './archivist.mjs';
import { Critic } from './critic.mjs';
import { SecurityReviewer, VERDICTS } from './security.mjs';
import { runScout } from './scout.mjs';
import { verify } from './verifier.mjs';
import { synthesize } from './synthesizer.mjs';
import { Budget } from './budget.mjs';

// Providers usable for failover: the builder first, then other configured
// providers. Mock is only included when it is the builder (never as a silent
// production fallback).
function providerChain(builder) {
  const chain = [builder];
  for (const [id, p] of Object.entries(listProviders())) {
    if (id === builder || id === 'mock') continue;
    if (p.hasKey || (id === 'ollama' && process.env.OLLAMA_BASE)) chain.push(id);
  }
  return chain;
}

// Providers the critic may use. Mock is the safe last resort so tests never
// make live calls to an unconfigured provider.
function criticProviders(builder) {
  const out = [];
  for (const [id, p] of Object.entries(listProviders())) {
    if (id === builder || id === 'mock') continue;
    if (p.hasKey || (id === 'ollama' && process.env.OLLAMA_BASE)) out.push(id);
  }
  out.push('mock');
  return out;
}

export async function* orchestrate({ message, provider, user = 'anon', store, conversationId, runId, signal, budget = new Budget() }) {
  const emit = (evt) => store.appendEvent(runId, evt);
  const isSuspended = () => store.getRun(runId)?.status === 'suspended';
  const checkpointPhase = (phase, data = {}) => {
    const ts = Date.now();
    try { void store.saveCheckpoint(runId, phase, { ...data, ts }); } catch {}
    emit({ type: 'checkpoint', phase, ...data, ts });
  };
  const memory = new VectorMemory(store);
  const archivist = new Archivist(store);
  const critic = new Critic({ store, defaultProvider: provider, independentProviders: criticProviders(provider) });
  const security = new SecurityReviewer({ store });

  /* Phase 0 — Archivist recall */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'recall', agentId: 'archivist' });
  const recalled = archivist.retrieve(message, { user, k: 6 });
  const memoryPacket = recalled.map((r) => ({ id: r.memory.id, type: r.memory.type ?? 'episodic', text: r.memory.text, score: Number(r.score.toFixed(3)) }));
  yield emit({ type: 'memory_packet', packet: memoryPacket });
  checkpointPhase('recall', { memoryCount: memoryPacket.length });

  /* Phase 1 — Scout */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'scout', agentId: 'scout' });
  const scout = await runScout({ message, provider, signal });
  yield emit({ type: 'scout_report', ...scout });
  checkpointPhase('scout', { report: scout });

  /* Phase 2 — Planner */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'plan', agentId: 'planner' });
  let planText = '';
  try {
    for await (const { delta, done } of chatStreamWithFallback({
      providers: providerChain(provider), system: AGENTS.planner.system,
      messages: [{ role: 'user', content: `${message}\n\nScout hints: ${JSON.stringify(scout)}\n\nRecalled memory:\n${memoryPacket.map((m) => `- ${m.text}`).join('\n') || '(none)'}` }],
      maxTokens: AGENTS.planner.maxTokens, signal,
    })) { if (done) break; planText += delta; budget.spend('tokens'); }
  } catch (e) {
    yield emit({ type: 'error', where: 'planner', message: e.message });
  }
  const plan = parsePlan(planText);
  yield emit({ type: 'planner_raw', raw: planText, steps: plan.steps });
  checkpointPhase('plan', { steps: plan.steps });

  /* Phase 3 — Security gate + Builder */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'execute', agentId: 'builder' });
  const toolResults = [];
  for (const step of plan.steps) {
    const decision = await security.gate({ tool: step.tool, args: step.args, user, runId, signal, onEvent: (e) => queueMicrotask(() => {}) });
    yield emit({ type: 'security_decision', decision });
    if (decision.verdict === VERDICTS.DENY) { toolResults.push({ tool: step.tool, ok: false, error: `denied: ${decision.reasons.join('; ')}` }); continue; }
    if (decision.verdict === VERDICTS.REQUIRE_APPROVAL) { toolResults.push({ tool: step.tool, ok: false, error: 'requires approval' }); continue; }
    try {
      budget.spend('toolCalls');
      const r = await runTool(step.tool, step.args, { memory, store, user, signal });
      const output = String(r);
      const scan = security.scanToolOutput(step.tool, output);
      if (scan.verdict === VERDICTS.QUARANTINE) {
        yield emit({ type: 'security_block', tool: step.tool, verdict: scan.verdict, reasons: scan.findings.map((f) => f.id) });
        toolResults.push({ tool: step.tool, ok: false, error: 'tool output quarantined' });
        continue;
      }
      toolResults.push({ tool: step.tool, ok: true, result: output });
      yield emit({ type: 'tool_result', tool: step.tool, result: output });
    } catch (e) {
      toolResults.push({ tool: step.tool, ok: false, error: e.message });
      yield emit({ type: 'tool_error', tool: step.tool, error: e.message });
    }
  }
  checkpointPhase('execute', { toolResults });

  /* Phase 4 — Verifier */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'verify', agentId: 'verifier' });
  const verification = verify({ message, toolResults });
  yield emit({ type: 'verification', ...verification });
  checkpointPhase('verify', { verification });

  /* Phase 5 — Synthesizer */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'synthesize', agentId: 'synthesizer' });
  const brief = synthesize({ message, toolResults, verification });
  yield emit({ type: 'brief', content: brief });
  checkpointPhase('synthesize', { brief });

  /* Phase 6 — Reviewer streams */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'review', agentId: 'reviewer' });
  yield emit({ type: 'message_start', agentId: 'reviewer' });
  let finalText = '';
  try {
    for await (const { delta, done } of chatStream({
      provider, system: AGENTS.reviewer.system,
      messages: [{ role: 'user', content: `Original request: ${message}\n\nEvidence brief:\n${brief}` }],
      maxTokens: AGENTS.reviewer.maxTokens, signal,
    })) {
      if (done) break;
      finalText += delta; budget.spend('tokens');
      yield emit({ type: 'chunk', agentId: 'reviewer', content: delta });
    }
  } catch (e) {
    yield emit({ type: 'error', where: 'reviewer', message: e.message });
  }
  yield emit({ type: 'message_end', agentId: 'reviewer', content: finalText });
  checkpointPhase('review', { finalText });

  /* Phase 7 — Critic */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'critique', agentId: 'critic' });
  let verdict = { overall: 'accept', findings: [], confidence: 0, calibrated: 'low', lenses: [] };
  try {
    verdict = await critic.review({ artifact: finalText, request: message, context: brief, builderProvider: provider, signal });
    yield emit({ type: 'critique', verdict });
    checkpointPhase('critic', { verdict });
  } catch (e) {
    yield emit({ type: 'error', where: 'critic', message: e.message });
  }

  /* Phase 8 — Archivist record */
  if (isSuspended()) { emit({ type: 'suspended', runId }); return; }
  yield emit({ type: 'phase', phase: 'archive', agentId: 'archivist' });
  try {
    await archivist.record({
      type: 'episodic',
      text: `Run for "${message.slice(0, 80)}": ${finalText.slice(0, 400)}`,
      importance: verdict.overall === 'reject' ? 4 : 3,
      user, provenance: [runId], tags: ['run', verdict.overall],
    });
  } catch {}

  yield emit({ type: 'budget', snapshot: budget.snapshot() });
  yield emit({ type: 'done' });
}

function parsePlan(text) {
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.steps)) return { steps: [] };
  return { steps: parsed.steps.slice(0, 8).filter((s) => s && typeof s.tool === 'string') };
}
