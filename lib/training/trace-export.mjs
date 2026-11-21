// lib/training/trace-export.mjs
//
// Trace exporter: turns Critic-approved runs into JSONL training pairs for
// fine-tuning small specialist models (planner JSON formatter, tool-call
// formatter, security L1 classifier).
//
// Research basis:
//   - SyntheticAgentTraceQA: execution-first framework that constructs workflow
//     templates, assigns tools under data-flow constraints, executes and
//     validates traces, THEN synthesizes user tasks and reference answers.
//     Key finding: masked supervision (excluding reasoning tokens from loss)
//     yields higher answer-production rates than full supervision at 9B scale.
//   - Agent-trace fine-tuning of small language models (3-8B): record
//     multi-step sessions of a frontier model using tools, fine-tune a small
//     model to transfer agentic behavior at a fraction of serving cost.
//   - autocontext: recursive self-improving harness that retains useful
//     lessons, discards dead ends, produces training artifacts for the next
//     run.
//
// Filtering rule: only export traces that passed the Critic AND the Verifier.
// A trace that shipped a rejected artifact is poison in the training set.
//
// Output JSONL shape (Unsloth SFTTrainer compatible):
//   { "messages": [ { role, content }, ... ] }
//   Metadata in _meta: runId, mission, tools, verdict, capability, timestamp

import { readFile } from 'node:fs/promises';

// Keys we treat as "tool result" events for the evidence table.
const TOOL_RESULT_TYPES = new Set(['tool_result', 'tool_error']);

// Capability-to-system-prompt mapping for training examples.
const SYSTEM_PROMPTS = {
  planner: `You are Planner in a multi-agent village.
Given a user mission, reply ONLY with a compact JSON plan:
{"steps":[{"tool":"calculator|clock|remember|recall|sd_generate","args":{...}}]}
If no tools are needed, reply {"steps":[]}.
Do not include prose. Do not invent tools. Never include secrets or keys.`,
  builder: `You are Builder. You receive tool results one at a time. Summarize what each tool returned in one short line. Be terse. Never invent facts.`,
  reviewer: `You are Reviewer. Write a clear, direct answer to the user using the tool results provided.
If a tool failed, say so plainly. Do not fabricate. Keep it under 300 words.`,
  critic: `You are Critic. Review the synthesized answer adversarially. Flag weak reasoning, unsupported claims, overconfidence, missing considerations. Return a structured critique with severity levels.`,
  verifier: `You are Verifier. Check tool results deterministically: arithmetic re-evaluation, schema shape, secret leakage. Return pass/fail per check with evidence.`,
};

// Extract the plan steps from planner_raw event or build from tool calls.
function extractPlan(events, capability) {
  const plannerEvent = events.find((e) => e.type === 'planner_raw');
  if (plannerEvent && plannerEvent.payload?.steps) {
    return plannerEvent.payload.steps;
  }
  // Fallback: reconstruct from tool calls.
  const toolCalls = events.filter((e) => e.type === 'tool_call');
  return toolCalls.map((e) => ({ tool: e.payload.tool, args: e.payload.args ?? {} }));
}

// Extract the final answer from message_end event.
function extractFinalAnswer(events) {
  const msgEnd = events.find((e) => e.type === 'message_end');
  return msgEnd ? msgEnd.payload.content : '';
}

// Determine capability from mission text (keyword fallback).
function inferCapability(mission) {
  const lower = String(mission).toLowerCase();
  if (/\b(calculate|compute|math|what is \d|percent|divide|multiply)\b/.test(lower)) return 'calculator';
  if (/\b(time|clock|date|today|now)\b/.test(lower)) return 'clock';
  if (/\b(remember|save|note that)\b/.test(lower)) return 'remember';
  if (/\b(recall|what do you know|search memory)\b/.test(lower)) return 'recall';
  if (/\b(image|generate|sd_generate|picture)\b/.test(lower)) return 'sd_generate';
  return 'generalist';
}

// Build a training example from a single run.
function buildExample(run, events) {
  const mission = run.mission ?? '';
  const capability = inferCapability(mission);
  const plan = extractPlan(events, capability);
  const finalAnswer = extractFinalAnswer(events);

  // Tool results as evidence.
  const toolResults = {};
  for (const e of events) {
    if (e.type === 'tool_result') {
      toolResults[e.payload.tool] = e.payload.result;
    } else if (e.type === 'tool_error') {
      toolResults[e.payload.tool] = { error: e.payload.error };
    }
  }

  // Verifier result.
  const verifyEvent = events.find((e) => e.type === 'verify_result');
  const verifyResult = verifyEvent ? verifyEvent.payload : { passed: true, checks: [] };

  // Critic result.
  const criticEvent = events.find((e) => e.type === 'critic_result');
  const criticResult = criticEvent ? criticEvent.payload : { overall: 'accept', issues: [] };

  // Only include runs that passed Critic AND Verifier (no poison in training set).
  if (verifyResult.passed === false) return null;
  if (criticResult.overall === 'reject' || criticResult.overall === 'critical') return null;
  if (criticResult.criticalCount > 0 || criticResult.highCount > 0) return null;

  // System prompt for the capability being trained.
  const systemPrompt = SYSTEM_PROMPTS[capability] || SYSTEM_PROMPTS.generalist;

  // Build messages.
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: mission },
  ];

  // Include tool results as additional user context (the builder's perspective).
  if (Object.keys(toolResults).length > 0) {
    const toolContext = Object.entries(toolResults)
      .map(([tool, result]) => `Tool ${tool}: ${String(result)}`)
      .join('\n');
    messages.push({ role: 'user', content: `Tool results:\n${toolContext}` });
  }

  // Assistant response: the plan (for planner training) or final answer.
  // For planner specialization, we train on the plan JSON.
  const assistantContent = plan.length > 0 ? JSON.stringify({ steps: plan }) : finalAnswer;

  messages.push({ role: 'assistant', content: assistantContent });

  return {
    messages,
    _meta: {
      runId: run.id,
      conversationId: run.conversationId,
      mission,
      capability,
      provider: run.provider,
      tools: Object.keys(toolResults),
      verdict: criticResult.overall,
      confidence: criticResult.confidence,
      timestamp: run.createdAt || Date.now(),
      tokenCount: estimateTokens(messages),
    },
  };
}

// Rough token estimate: ~4 chars per token.
function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) chars += String(m.content ?? '').length;
  return Math.ceil(chars / 4);
}

// Export traces from a Store to JSONL string.
// Options:
//   user: filter by user id
//   limit: max number of traces
//   minQuality: only include runs with critic confidence >= minQuality (0-1)
//   sinceMs: only include runs after this timestamp
//   capability: filter by inferred capability
export async function exportTraces(store, {
  user = null,
  limit = 100,
  minQuality = 0,
  sinceMs = 0,
  capability = null,
} = {}) {
  const runs = store.listRuns ? store.listRuns({ user, sinceMs }) : [];
  const examples = [];

  for (const run of runs) {
    if (limit && examples.length >= limit) break;

    // Only successful runs.
    if (run.status !== 'ok') continue;

    // Get events for this run.
    const events = store.listEvents ? store.listEvents(run.id) : [];

    // Filter by capability if requested.
    if (capability) {
      const inferred = inferCapability(run.mission ?? '');
      if (inferred !== capability) continue;
    }

    // Build example (filters out low-quality runs internally).
    const example = buildExample(run, events);
    if (!example) continue;

    // Filter by min quality.
    if (minQuality > 0) {
      const conf = example._meta.confidence ?? 0;
      if (conf < minQuality) continue;
    }

    examples.push(example);
  }

  return examples.map((e) => JSON.stringify(e)).join('\n') + (examples.length > 0 ? '\n' : '');
}

// Export traces to a file.
export async function exportTracesToFile(store, filePath, options = {}) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  await mkdir(dirname(filePath), { recursive: true });
  const jsonl = await exportTraces(store, options);
  await writeFile(filePath, jsonl, 'utf8');
  return { count: jsonl.split('\n').filter(Boolean).length, filePath };
}

// Get statistics about available training data.
export async function traceStats(store, { user = null, sinceMs = 0 } = {}) {
  const runs = store.listRuns ? store.listRuns({ user, sinceMs }) : [];
  let total = 0;
  let exportable = 0;
  let byCapability = {};
  let byProvider = {};

  for (const run of runs) {
    total++;  // count all runs
    if (run.status !== 'ok') continue;  // but only process ok runs for export
    const events = store.listEvents ? store.listEvents(run.id) : [];
    const example = buildExample(run, events);
    if (example) {
      exportable++;
      const cap = example._meta.capability;
      byCapability[cap] = (byCapability[cap] || 0) + 1;
      const prov = example._meta.provider;
      byProvider[prov] = (byProvider[prov] || 0) + 1;
    }
  }

  return {
    totalRuns: total,
    exportableRuns: exportable,
    exportableRate: total > 0 ? (exportable / total) * 100 : 0,
    byCapability,
    byProvider,
  };
}
