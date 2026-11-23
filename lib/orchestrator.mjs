import { AGENTS } from './agents.mjs';
import { runTool } from './tools.mjs';
import { chatStream, chatStreamWithFallback, providerChain, listProviders } from './llm.mjs';
import { extractJson } from './json.mjs';
import { VectorMemory } from './memory.mjs';
import { Archivist } from './archivist.mjs';
import { Critic, LENSES } from './critic.mjs';
import { SecurityReviewer, VERDICTS } from './security.mjs';
import { runScout } from './scout.mjs';
import { verify } from './verifier.mjs';
import { synthesize } from './synthesizer.mjs';
import { Budget } from './budget.mjs';

// Providers the critic may use: other configured providers, with mock as the
// safe last resort so tests never make live calls to an unconfigured provider.
function criticProviders(builder) {
  const chain = providerChain(builder, { includeMock: false });
  if (!chain.includes('mock')) chain.push('mock');
  return chain;
}

export async function* orchestrate({ message, provider, user = 'anon', store, conversationId, runId, signal, budget = new Budget() }) {
  const emit = (evt) => store.appendEvent(runId, evt);
  const memory = new VectorMemory(store);
  const archivist = new Archivist(store);
  const critic = new Critic({ store, defaultProvider: provider, independentProviders: criticProviders(provider) });
  const security = new SecurityReviewer({ store, provider, llm: { chatStream, chatStreamWithFallback, providerChain } });

  /* Phase 0 — Archivist recall */
  yield emit({ type: 'phase', phase: 'recall', agentId: 'archivist' });
  const recalled = archivist.retrieve(message, { user, k: 6 });
  const memoryPacket = recalled.map((r) => ({ id: r.memory.id, type: r.memory.type ?? 'episodic', text: r.memory.text, score: Number(r.score.toFixed(3)) }));
  yield emit({ type: 'memory_packet', packet: memoryPacket });

  /* Phase 1 — Scout */
  yield emit({ type: 'phase', phase: 'scout', agentId: 'scout' });
  const scout = await runScout({ message, provider, signal });
  yield emit({ type: 'scout_report', ...scout });

  /* Phase 2 — Planner */
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

  /* Phase 3 — Security gate + Builder */
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

  /* Phase 4 — Verifier */
  yield emit({ type: 'phase', phase: 'verify', agentId: 'verifier' });
  const verification = verify({ message, toolResults });
  yield emit({ type: 'verification', ...verification });

  /* Phase 5 — Synthesizer */
  yield emit({ type: 'phase', phase: 'synthesize', agentId: 'synthesizer' });
  const brief = synthesize({ message, toolResults, verification });
  yield emit({ type: 'brief', content: brief });

  /* Phase 6 — Reviewer streams */
  yield emit({ type: 'phase', phase: 'review', agentId: 'reviewer' });
  yield emit({ type: 'message_start', agentId: 'reviewer' });
  let finalText = '';
  try {
    for await (const { delta, done } of chatStreamWithFallback({
      providers: providerChain(provider), system: AGENTS.reviewer.system,
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

  /* Phase 7 — Critic */
  yield emit({ type: 'phase', phase: 'critique', agentId: 'critic' });
  let verdict = { overall: 'accept', findings: [], confidence: 0, calibrated: 'low', lenses: [] };
  try {
    verdict = await critic.review({ artifact: finalText, request: message, context: brief, builderProvider: provider, signal });
    budget.spend('llm_calls', Object.keys(LENSES).length);
    yield emit({ type: 'critique', verdict });
  } catch (e) {
    yield emit({ type: 'error', where: 'critic', message: e.message });
  }

  /* Revision gate: one retry, never a loop. The reviewer re-streams incorporating
     the critic's findings. Uses the same failover chain and event shape as the
     primary review so clients see a consistent stream. */
  if (verdict.overall === 'reject' && (verdict.confidence ?? 0) >= 0.6) {
    yield emit({ type: 'revision_requested', findings: verdict.findings, summary: verdict.summary });
    const critiqueBlock = `Original request: ${message}\n\nEvidence brief:\n${brief}\n\nCritic revision required:\n${verdict.findings
      .map((f) => `- ${f.finding ?? f.gaps?.join('; ') ?? f.counterCase ?? f.note ?? 'issue'}`)
      .join('\n')}`;
    finalText = '';
    yield emit({ type: 'message_start', agentId: 'reviewer' });
    try {
      for await (const { delta, done } of chatStreamWithFallback({
        providers: providerChain(provider), system: AGENTS.reviewer.system,
        messages: [{ role: 'user', content: critiqueBlock }],
        maxTokens: AGENTS.reviewer.maxTokens, signal,
      })) {
        if (done) break;
        finalText += delta; budget.spend('tokens');
        yield emit({ type: 'chunk', agentId: 'reviewer', content: delta });
      }
    } catch (e) {
      yield emit({ type: 'error', where: 'reviewer-revision', message: e.message });
    }
    yield emit({ type: 'message_end', agentId: 'reviewer', content: finalText });
  }

  /* Phase 8 — Archivist record */
  yield emit({ type: 'phase', phase: 'archive', agentId: 'archivist' });
  try {
    const entry = await archivist.record({
      type: 'episodic',
      text: `Run for "${message.slice(0, 80)}": ${finalText.slice(0, 400)}`,
      importance: verdict.overall === 'reject' ? 4 : 3,
      user, provenance: [runId], tags: ['run', verdict.overall],
    });
    const lessons = deriveLessons(store?.listEvents ? store.listEvents(runId) : []);
    yield emit({ type: 'archive_written', memoryId: entry.id, lessons });
  } catch {}

  yield emit({ type: 'budget', snapshot: budget.snapshot() });
  yield emit({ type: 'done' });
}

function parsePlan(text) {
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.steps)) return { steps: [] };
  return { steps: parsed.steps.slice(0, 8).filter((s) => s && typeof s.tool === 'string') };
}
