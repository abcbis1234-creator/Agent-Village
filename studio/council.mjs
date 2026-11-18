import { generateWithModel } from './model-gateway.mjs';

const ROLES = [
  { id: 'nova', name: 'Nova', specialty: 'Planner', instruction: 'Convert the mission into a measurable outcome, milestones, dependencies, and acceptance criteria.' },
  { id: 'atlas', name: 'Atlas', specialty: 'Architect', instruction: 'Design the system or solution. Identify components, interfaces, constraints, and trade-offs.' },
  { id: 'lyra', name: 'Lyra', specialty: 'Research analyst', instruction: 'Identify facts to verify, evidence gaps, assumptions, and what reliable sources would be needed. Do not invent sources.' },
  { id: 'forge', name: 'Forge', specialty: 'Builder', instruction: 'Propose a minimal implementation plan, concrete deliverables, tests, and failure handling.' },
  { id: 'echo', name: 'Echo', specialty: 'Independent reviewer', instruction: 'Critically review the other agents. Find contradictions, unsupported claims, security risks, missing tests, and reasons to reject or revise the proposal.' }
];

function clean(value, name, max) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(name + ' is required');
  if (value.trim().length > max) throw new Error(name + ' is too long');
  return value.trim();
}

export async function runCouncil({ mission, assignments, env = process.env, fetchImpl = fetch } = {}) {
  const task = clean(mission, 'mission', 1200);
  if (!Array.isArray(assignments) || assignments.length !== 5) throw new Error('Select a provider for all five agents');
  const byRole = new Map(assignments.map((item) => [item.role, item.provider]));
  if (ROLES.some((role) => !['ollama', 'openai', 'anthropic', 'gemini'].includes(byRole.get(role.id)))) throw new Error('Unsupported provider assignment');
  const base = await Promise.all(ROLES.slice(0, 4).map(async (role) => {
    const provider = byRole.get(role.id);
    const result = await generateWithModel({
      provider, prompt: 'MISSION:\n' + task + '\n\nYOUR ROLE: ' + role.specialty + '\nTASK: ' + role.instruction + '\n\nReturn a concise, structured contribution. Clearly label assumptions and uncertainty.',
      system: 'You are ' + role.name + ', a specialist agent in a supervised multi-agent council. You are not an autonomous system. Do not claim actions you did not perform.',
      env, fetchImpl
    });
    return { role: { id: role.id, name: role.name, specialty: role.specialty }, provider: result.provider, model: result.model, text: result.text };
  }));
  const reviewer = ROLES[4];
  const reviewProvider = byRole.get(reviewer.id);
  const review = await generateWithModel({
    provider: reviewProvider,
    prompt: 'MISSION:\n' + task + '\n\nINDEPENDENT REVIEW: challenge these four contributions. Identify agreement, disagreements, unsupported assertions, missing evidence, risks, and concrete corrections. Do not merely summarize.\n\n' + base.map((item) => item.role.name + ' (' + item.provider + '/' + item.model + '):\n' + item.text).join('\n\n'),
    system: 'You are Echo, an independent reviewer. Be skeptical, evidence-oriented, and specific. Never fabricate verification.',
    env, fetchImpl
  });
  return {
    id: 'council-' + Date.now(),
    mission: task,
    mode: 'live-model-calls',
    reports: [...base, { role: { id: reviewer.id, name: reviewer.name, specialty: reviewer.specialty }, provider: review.provider, model: review.model, text: review.text }],
    review: { provider: review.provider, model: review.model, text: review.text },
    approvalRequired: true,
    notice: 'These are model-generated proposals, not verified facts or completed actions. Human review is required.'
  };
}
