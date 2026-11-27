// lib/routing/free-first.mjs
//
// Free-first provider router. Core insight: inference cost isn't the model you
// pick — it's routing each request to the cheapest *capable* model. Trivial
// tasks go to free models; frontier models only handle the irreducible hard
// parts.
//
// Free API tiers (rate-limited, zero marginal cost):
//   - Groq:      1,000 RPD per model, permanent free tier, OpenAI-compatible
//   - NVIDIA NIM: 8 models free forever (Mistral 675B, Nemotron vision), via
//                OpenRouter-style endpoints
//   - OpenRouter: 35+ free models but ~50 RPD — fallback, not primary
// Open-weight (run locally, zero marginal cost):
//   - Ornith-9B / Ornith-31B (MIT, agentic coding)
//   - Laguna XS.2 (33B MoE, 3B active per token, runs on 36GB Mac)
//   - GLM-5.2 (open-weight coding, strong on benchmarks)
//   - Muse Glimmer-30B (meta, local-agentic multimodal)
//
// Paid (last resort, for ambiguity and architecture):
//   - GLM-5.2 hosted, Claude-4.8, GPT-5.5
//
// Tier selection: every task starts at the cheapest tier that can handle it.
// Routing score is based on complexity heuristics: length, code-ish tokens,
// ambiguity markers, tool count, and prior failure history.

export const TIERS = [
  {
    name: 'local',
    cost: 0,
    latency: 'variable',
    models: ['ornith-9b', 'laguna-xs', 'glm-5.2'],
    maxTokens: 4096,
    bestFor: ['formatting', 'classification', 'simple-transformation', 'code-completion'],
  },
  {
    name: 'free-api',
    cost: 0,
    latency: 'fast',
    models: ['groq/llama-3.3-70b', 'nvidia/gpt-oss-120b'],
    maxTokens: 8192,
    bestFor: ['summarization', 'simple-tool-calls', 'general-chat', 'extraction'],
  },
  {
    name: 'paid',
    cost: '$$',
    latency: 'fast',
    models: ['glm-5.2', 'claude-4.8', 'gpt-5.5'],
    maxTokens: 32768,
    bestFor: ['architecture', 'novel-reasoning', 'complex-planning', 'ambiguous-tasks'],
  },
];

// Cost per 1M tokens (approximate, for cost accounting in metrics).
export const COST_PER_1M_TOKENS = {
  local: 0,
  'free-api': 0,
  paid: 2.0,
};

// Heuristic signals that a task is trivial (can go to local/fast models).
const TRIVIAL_SIGNALS = [
  /^(hello|hi|hey|goodbye|bye|thanks|thank you)\b/i,
  /^(what is|what's)\s+(the\s+)?(time|date|day|weather)\b/i,
  /^(convert|format|jsonify|lowercase|uppercase|trim)\b/i,
  /^(is|are)\s+.+\s+(true|false|valid|correct)\b/i,
];

// Heuristic signals that a task is routine (can go to free API tier).
const ROUTINE_SIGNALS = [
  /summarize|summary|sum up|tl;dr|in short/i,
  /translate|rewrite|paraphrase|rephrase/i,
  /extract|pull out|find all|list all/i,
  /calculate|compute|math|what is \d/i,
  /what time|what date|what day|now|today/i,
];

// Heuristic signals that a task is complex (needs paid tier).
const COMPLEX_SIGNALS = [
  /architecture|design|microservice|distributed|system|pipeline|workflow/i,
  /refactor|migrate|novel|invent|create from scratch|blueprint/i,
  /ambiguous|unclear|not sure|maybe|perhaps/i,
  /multi.step|orchestrat|workflow/i,
  /security|audit|compliance|penetration/i,
  /retry|dead letter|fault.?tolerant/i,
];

function scoreComplexity(message) {
  const lower = message.toLowerCase();
  let score = 0;

  // Length: longer = more complex.
  const len = message.length;
  if (len > 2000) score += 3;
  else if (len > 800) score += 2;
  else if (len > 300) score += 1;

  // Complexity signals.
  for (const re of COMPLEX_SIGNALS) {
    if (re.test(lower)) score += 2;
  }

  // Routine signals reduce complexity.
  for (const re of ROUTINE_SIGNALS) {
    if (re.test(lower)) score -= 1;
  }

  // Trivial signals reduce more.
  for (const re of TRIVIAL_SIGNALS) {
    if (re.test(lower)) score -= 2;
  }

  // Tool count hint: more tools = more complex.
  const toolMentions = (lower.match(/calculator|clock|remember|recall|storyboard|sd_generate|image|generate|search|web|fetch|video|reel/i) || []).length;
  if (toolMentions > 2) score += 1;
  if (toolMentions > 4) score += 1;

  return Math.max(0, score);
}

// Route a request to the cheapest capable tier.
// Returns { tier, model, reason, score }.
export function route(request) {
  const message = String(request.message ?? '');
  const context = request.context ?? {};
  const forceTier = context.forceTier;
  const preferLocal = context.preferLocal !== false;
  const maxCost = context.maxCost; // null = no limit

  // Budget constraint takes priority: if max cost is set, cap the tier.
  if (maxCost !== undefined && COST_PER_1M_TOKENS.paid > maxCost) {
    // Can't afford paid tier; downgrade to cheapest tier within budget.
    for (const t of TIERS) {
      if (COST_PER_1M_TOKENS[t.name] <= maxCost) {
        return {
          tier: t.name,
          model: t.models[0],
          provider: t.name === 'local' ? 'local' : t.name === 'free-api' ? 'free-api' : 'paid',
          cost: COST_PER_1M_TOKENS[t.name],
          score: scoreComplexity(message),
          reason: `budget-constrained downgrade to ${t.name}`,
          maxTokens: t.maxTokens,
          bestFor: t.bestFor,
        };
      }
    }
    // No tier fits budget; fall back to local (free).
    const t = TIERS[0];
    return {
      tier: t.name,
      model: t.models[0],
      provider: 'local',
      cost: 0,
      score: scoreComplexity(message),
      reason: 'budget-constrained downgrade to local',
      maxTokens: t.maxTokens,
      bestFor: t.bestFor,
    };
  }

  let score = scoreComplexity(message);

  // Adjust score based on context hints.
  if (context.requiresReasoning) score += 2;
  if (context.requiresCode) score += 1;
  if (context.requiresJson) score += 1;
  if (context.ambiguous) score += 2;
  if (context.simple) score -= 2;
  if (context.fast) score -= 1;

  // Determine tier by score.
  let tierName;
  let reason;

  if (score <= 1 && preferLocal) {
    tierName = 'local';
    reason = 'trivial task routed to free local model';
  } else if (score <= 2) {
    tierName = 'free-api';
    reason = 'routine task routed to free API tier';
  } else {
    tierName = 'paid';
    reason = 'complex task routed to paid tier';
  }

  // Honor explicit tier override.
  if (forceTier && TIERS.some((t) => t.name === forceTier)) {
    tierName = forceTier;
    reason = `client-requested tier: ${forceTier}`;
  }

  const tier = TIERS.find((t) => t.name === tierName) || TIERS[1];
  // Pick model: prefer first model in tier (cheapest/fastest).
  const model = tier.models[0];

  return {
    tier: tier.name,
    model,
    provider: tier.name === 'local' ? 'local' : tier.name === 'free-api' ? 'free-api' : 'paid',
    cost: COST_PER_1M_TOKENS[tier.name],
    score,
    reason,
    maxTokens: tier.maxTokens,
    bestFor: tier.bestFor,
  };
}

// Get all available models across tiers.
export function listAvailableModels() {
  return TIERS.flatMap((t) => t.models.map((m) => ({ model: m, tier: t.name, cost: COST_PER_1M_TOKENS[t.name] })));
}

// Get tier info by name.
export function getTier(name) {
  return TIERS.find((t) => t.name === name) || null;
}

// Estimate cost for a given token count and tier.
export function estimateCost(tierName, tokenCount) {
  const costPer1M = COST_PER_1M_TOKENS[tierName] ?? 0;
  return (tokenCount / 1_000_000) * costPer1M;
}
