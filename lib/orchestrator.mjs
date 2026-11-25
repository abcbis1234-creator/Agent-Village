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

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

// Explicit phase gates (ORCH-014). A phase may only start when its entry
// criteria hold and may only hand off when its exit criteria hold. The checks
// are deliberately cheap and structural: they catch empty/partial outputs
// without second-guessing the models.
export const PHASE_GATES = {
  recall: {
    entry: [{ id: 'message', reason: 'message is required', check: (s) => hasText(s.message) }],
    exit: [{ id: 'packet', reason: 'memory packet must be an array', check: (s) => Array.isArray(s.memoryPacket) }],
  },
  scout: {
    entry: [{ id: 'message', reason: 'message is required', check: (s) => hasText(s.message) }],
    exit: [{ id: 'report', reason: 'scout report must include intent and domain', check: (s) => Boolean(s.scout) && typeof s.scout.intent === 'string' && typeof s.scout.domain === 'string' }],
  },
  plan: {
    entry: [{ id: 'scout', reason: 'a scout report is required before planning', check: (s) => Boolean(s.scout) && typeof s.scout.intent === 'string' }],
    exit: [{ id: 'steps', reason: 'plan must expose a steps array', check: (s) => Boolean(s.plan) && Array.isArray(s.plan.steps) }],
  },
  execute: {
    entry: [{ id: 'verified-plan', reason: 'a verified plan is required before execution', check: (s) => Array.isArray(s.executableSteps) }],
    exit: [{ id: 'results', reason: 'every tool result must be normalized', check: (s) => Array.isArray(s.toolResults) && s.toolResults.every((r) => r && typeof r.tool === 'string' && typeof r.ok === 'boolean') }],
  },
  synthesize: {
    entry: [{ id: 'results', reason: 'tool results are required before synthesis', check: (s) => Array.isArray(s.toolResults) }],
    exit: [{ id: 'brief', reason: 'brief must be non-empty', check: (s) => hasText(s.brief) }],
  },
  critique: {
    entry: [{ id: 'brief', reason: 'a non-empty brief is required before critique', check: (s) => hasText(s.brief) }],
    exit: [{ id: 'final', reason: 'final text must be a string', check: (s) => typeof s.finalText === 'string' }],
  },
  archive: {
    entry: [{ id: 'final', reason: 'refusing to archive an empty answer', check: (s) => hasText(s.finalText) }],
  },
};

export function checkPhaseGate(phase, kind, state = {}) {
  const criteria = PHASE_GATES[phase]?.[kind] ?? [];
  const failures = criteria.filter((c) => !c.check(state)).map((c) => ({ id: c.id, reason: c.reason }));
  return { ok: failures.length === 0, phase, kind, reasons: failures.map((f) => f.reason), failures };
}

export async function* orchestrate({ message, provider, user = 'anon', store, conversationId, runId, signal, budget = new Budget(), resume = false }) {
  let currentPhase = 'queued';
  const emit = (evt) => {
    if (evt.phase) currentPhase = evt.phase;
    const record = store.appendEvent(runId, evt);
    // Heartbeat (DUR-030): persist the phase and progress with every event.
    store.heartbeat?.(runId, { phase: currentPhase, progress: record?.seq ?? 0 });
    return record;
  };
  // Enforce a phase gate. On failure, surface the reason to the client and
  // stop the pipeline rather than silently advancing with partial output.
  function* gate(phase, kind, snapshot) {
    const result = checkPhaseGate(phase, kind, snapshot);
    if (result.ok) return;
    yield emit({ type: 'phase_gate_failed', phase, gate: kind, reasons: result.reasons, failures: result.failures });
    const err = new Error(`phase ${phase} ${kind} gate failed: ${result.reasons.join('; ')}`);
    err.code = 'PHASE_GATE';
    err.phase = phase;
    err.gate = kind;
    throw err;
  }
  const memory = new VectorMemory(store);
  const archivist = new Archivist(store);
  const critic = new Critic({ store, defaultProvider: provider, independentProviders: criticProviders(provider) });
  const security = new SecurityReviewer({ store, provider, llm: { chatStream, chatStreamWithFallback, providerChain } });

  // Orchestration metrics (#38): plan depth, node outcomes, rework, fallback.
  const metrics = { planDepth: 0, stepsAccepted: 0, nodesSucceeded: 0, nodesDenied: 0, nodesFailed: 0, revisions: 0, fallbacks: 0 };

  // Checkpoint/resume (#1): each phase persists its output via saveCheckpoint.
  // On resume, a phase whose checkpoint exists is skipped — its cached output is
  // re-emitted as events so clients see the full stream — and tools with side
  // effects (sd_generate, external_http) are never re-run.
  const cachedPhase = (phase) => {
    if (!resume || !store.getCheckpoint) return null;
    const cp = store.getCheckpoint(runId, phase);
    return cp?.data ?? null;
  };
  async function* checkpoint(phase, data) {
    if (!store.saveCheckpoint) return;
    try {
      await store.saveCheckpoint(runId, phase, data);
      yield emit({ type: 'checkpoint', phase, runId });
    } catch { /* best-effort */ }
  }
  const resumed = (phase) => emit({ type: 'phase_resumed', phase, runId });
  // Suspend: pause the pipeline at a phase boundary and stream the event to
  // the client. Completed checkpoints are preserved, so POST /api/runs/:id/resume
  // continues from where it stopped.
  async function* suspendCheck(phase) {
    if (store.getRun?.(runId)?.status !== 'suspended') return false;
    yield emit({ type: 'suspended', phase, runId });
    return true;
  }

  yield emit({ type: 'heartbeat', phase: 'queued', runId, at: Date.now() });

  /* Phase 0 — Archivist recall */
  if (yield* suspendCheck('recall')) return;
  yield* gate('recall', 'entry', { message });
  yield emit({ type: 'phase', phase: 'recall', agentId: 'archivist' });
  let memoryPacket = cachedPhase('recall');
  if (memoryPacket) yield resumed('recall');
  else {
    const recalled = archivist.retrieve(message, { user, k: 6 });
    memoryPacket = recalled.map((r) => ({ id: r.memory.id, type: r.memory.type ?? 'episodic', text: r.memory.text, score: Number(r.score.toFixed(3)) }));
    yield* checkpoint('recall', memoryPacket);
  }
  yield* gate('recall', 'exit', { memoryPacket });
  yield emit({ type: 'memory_packet', packet: memoryPacket });

  /* Phase 1 — Scout */
  if (yield* suspendCheck('scout')) return;
  yield* gate('scout', 'entry', { message });
  yield emit({ type: 'phase', phase: 'scout', agentId: 'scout' });
  let scout = cachedPhase('scout');
  if (scout) yield resumed('scout');
  else {
    scout = await runScout({ message, provider, signal });
    yield* checkpoint('scout', scout);
  }
  yield* gate('scout', 'exit', { scout });
  yield emit({ type: 'scout_report', ...scout });

  /* Phase 2 — Planner */
  if (yield* suspendCheck('plan')) return;
  yield* gate('plan', 'entry', { scout });
  yield emit({ type: 'phase', phase: 'plan', agentId: 'planner' });
  let planText = '';
  let plan = cachedPhase('plan');
  if (plan) yield resumed('plan');
  else {
    try {
      for await (const { delta, done } of chatStreamWithFallback({
        providers: providerChain(provider), system: AGENTS.planner.system,
        messages: [{ role: 'user', content: `${message}\n\nScout hints: ${JSON.stringify(scout)}\n\nRecalled memory:\n${memoryPacket.map((m) => `- ${m.text}`).join('\n') || '(none)'}` }],
        maxTokens: AGENTS.planner.maxTokens, signal,
      })) { if (done) break; planText += delta; budget.spend('tokens'); }
    } catch (e) {
      yield emit({ type: 'error', where: 'planner', message: e.message });
    }
    plan = { planText, steps: parsePlan(planText).steps };
    yield* checkpoint('plan', plan);
  }
  yield* gate('plan', 'exit', { plan });
  yield emit({ type: 'planner_raw', raw: plan.planText ?? '', steps: plan.steps });

  /* Phase 2.5 — Pre-execution plan verification (#34). Validate every step
     (tool exists, args match schema, budget feasible) BEFORE running any of
     them, so a bad plan fails fast instead of half-executing. */
  const planCheck = verifyPlan(plan.steps, security);
  if (planCheck.rejected.length) {
    yield emit({ type: 'plan_verification', ok: false, rejected: planCheck.rejected, depth: plan.steps.length });
  } else {
    yield emit({ type: 'plan_verification', ok: true, depth: plan.steps.length });
  }
  const executableSteps = planCheck.accepted;
  metrics.planDepth = plan.steps.length;
  metrics.stepsAccepted = executableSteps.length;

  /* Phase 3 — Security gate + Builder */
  if (yield* suspendCheck('execute')) return;
  yield* gate('execute', 'entry', { executableSteps });
  yield emit({ type: 'phase', phase: 'execute', agentId: 'builder' });
  const toolResults = [];
  const cachedExec = cachedPhase('execute');
  if (cachedExec) {
    yield resumed('execute');
    for (const r of cachedExec) {
      toolResults.push(r);
      if (r.ok) yield emit({ type: 'tool_result', tool: r.tool, result: r.result });
      else yield emit({ type: 'tool_error', tool: r.tool, error: r.error });
    }
  } else {
    for (const step of executableSteps) {
      const decision = await security.gate({ tool: step.tool, args: step.args, user, runId, signal, onEvent: (e) => queueMicrotask(() => {}) });
      yield emit({ type: 'security_decision', decision });
      if (decision.verdict === VERDICTS.DENY) { toolResults.push({ tool: step.tool, ok: false, error: `denied: ${decision.reasons.join('; ')}` }); metrics.nodesDenied++; continue; }
      if (decision.verdict === VERDICTS.REQUIRE_APPROVAL) { toolResults.push({ tool: step.tool, ok: false, error: 'requires approval' }); continue; }
      try {
        budget.spend('toolCalls');
        const r = await runTool(step.tool, step.args, { memory, store, user, signal });
        const output = String(r);
        metrics.nodesSucceeded++;
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
        metrics.nodesFailed++;
        yield emit({ type: 'tool_error', tool: step.tool, error: e.message });
      }
    }
    yield* checkpoint('execute', toolResults);
  }
  yield* gate('execute', 'exit', { toolResults });

  /* Phase 4 + 5 — Verifier + Synthesizer (combined checkpoint) */
  if (yield* suspendCheck('synthesize')) return;
  yield* gate('synthesize', 'entry', { toolResults });
  let verification;
  let brief;
  const cachedSynth = cachedPhase('synthesize');
  if (cachedSynth) {
    yield resumed('synthesize');
    verification = cachedSynth.verification;
    brief = cachedSynth.brief;
  } else {
    yield emit({ type: 'phase', phase: 'verify', agentId: 'verifier' });
    verification = verify({ message, toolResults });
    yield emit({ type: 'verification', ...verification });
    yield emit({ type: 'phase', phase: 'synthesize', agentId: 'synthesizer' });
    brief = synthesize({ message, toolResults, verification });
    yield* checkpoint('synthesize', { verification, brief });
  }
  yield* gate('synthesize', 'exit', { brief });
  yield emit({ type: 'brief', content: brief });

  /* Phase 6 + 7 — Reviewer + Critic + revision gate (combined checkpoint) */
  if (yield* suspendCheck('critique')) return;
  yield* gate('critique', 'entry', { brief });
  let finalText = '';
  let verdict = { overall: 'accept', findings: [], confidence: 0, calibrated: 'low', lenses: [] };
  const cachedCritique = cachedPhase('critique');
  if (cachedCritique) {
    yield resumed('critique');
    finalText = cachedCritique.finalText ?? '';
    verdict = cachedCritique.verdict ?? verdict;
    yield emit({ type: 'message_start', agentId: 'reviewer' });
    yield emit({ type: 'message_end', agentId: 'reviewer', content: finalText });
    yield emit({ type: 'critique', verdict });
  } else {
    yield emit({ type: 'phase', phase: 'review', agentId: 'reviewer' });
    yield emit({ type: 'message_start', agentId: 'reviewer' });
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

    yield emit({ type: 'phase', phase: 'critique', agentId: 'critic' });
    try {
      verdict = await critic.review({ artifact: finalText, request: message, context: brief, builderProvider: provider, signal });
      budget.spend('llm_calls', Object.keys(LENSES).length);
      yield emit({ type: 'critique', verdict });
    } catch (e) {
      yield emit({ type: 'error', where: 'critic', message: e.message });
    }

    /* Revision gate: one retry, never a loop. */
    if (verdict.overall === 'reject' && (verdict.confidence ?? 0) >= 0.6) {
      metrics.revisions++;
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

    yield* checkpoint('critique', { finalText, verdict });
  }
  yield* gate('critique', 'exit', { finalText });

  /* Phase 8 — Archivist record */
  if (yield* suspendCheck('archive')) return;
  yield* gate('archive', 'entry', { finalText });
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
  yield emit({ type: 'orchestration_metrics', metrics: { ...metrics, nodeSuccessRate: metrics.stepsAccepted ? Number((metrics.nodesSucceeded / metrics.stepsAccepted).toFixed(3)) : 1 } });
  yield emit({ type: 'done' });
}

// Derive short, deterministic lessons from the run's own events — no extra
// LLM call and nothing untrusted is executed. (Previously undefined, which
// made the archive_written event silently fail inside a catch-all.)
function deriveLessons(events = []) {
  const lessons = [];
  for (const e of events) {
    if (e.type === 'security_block') lessons.push(`blocked ${e.tool}: ${(e.reasons ?? []).join(', ')}`);
    else if (e.type === 'tool_error') lessons.push(`tool ${e.tool} failed: ${e.error}`);
    else if (e.type === 'critique' && e.verdict?.overall === 'reject') {
      lessons.push(`critic rejected: ${(e.verdict.findings ?? []).map((f) => f.finding ?? 'issue').join(', ')}`);
    }
  }
  return lessons.slice(0, 5);
}

function parsePlan(text) {
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.steps)) return { steps: [] };
  return { steps: parsed.steps.slice(0, 8).filter((s) => s && typeof s.tool === 'string') };
}

// Pre-execution plan verification (#34). Validates every step before any of
// them run: the tool must exist in the security policy, args must be an object,
// and required schema fields must be present with the right primitive type.
// Returns { accepted, rejected } where rejected entries carry a reason.
export function verifyPlan(steps, security) {
  const accepted = [];
  const rejected = [];
  for (const step of steps) {
    const reason = checkStep(step, security);
    if (reason) rejected.push({ tool: step.tool, reason });
    else accepted.push(step);
  }
  return { accepted, rejected };
}

function checkStep(step, security) {
  if (!step || typeof step.tool !== 'string' || !step.tool) return 'step has no tool';
  const spec = security?.policy?.tools?.[step.tool];
  if (!spec) return `unknown tool: ${step.tool}`;
  const args = step.args ?? {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'args must be an object';
  for (const [key, type] of Object.entries(spec.schema ?? {})) {
    const optional = type.endsWith('?');
    const base = type.replace(/\?$/, '');
    const val = args[key];
    if (val === undefined) { if (!optional) return `missing required arg: ${key}`; continue; }
    if (base === 'string' && typeof val !== 'string') return `${key} must be string`;
    if (base === 'number' && typeof val !== 'number') return `${key} must be number`;
    if (base === 'string[]' && !Array.isArray(val)) return `${key} must be array`;
  }
  for (const key of Object.keys(args)) if (!(key in (spec.schema ?? {}))) return `unexpected arg: ${key}`;
  return null;
}
