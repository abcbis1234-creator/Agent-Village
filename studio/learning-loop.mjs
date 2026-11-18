import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = { schemaVersion: 1, sessions: [], feedback: [], proposals: [], versions: [], activeVersionId: null };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function boundedText(value, field, max, required = true) {
  if (typeof value !== 'string') throw new Error(field + ' must be text');
  const result = value.trim();
  if (required && !result) throw new Error(field + ' is required');
  if (result.length > max) throw new Error(field + ' must be ' + max + ' characters or fewer');
  return result;
}
function evaluateProposal(text) {
  const checks = {
    specific: text.length >= 40,
    actionable: /\b(when|if|must|should|check|verify|include|avoid|record|compare|test|ask|use)\b/i.test(text),
    bounded: text.length <= 1200,
    notCode: !/(?:\b(?:eval|exec|child_process|shell command|delete all|ignore all rules)\b)/i.test(text)
  };
  const score = Object.values(checks).filter(Boolean).length / 4;
  return { score, checks, eligible: score >= 0.75, note: score >= 0.75 ? 'Eligible for human review; this is a heuristic, not proof of quality or safety.' : 'Needs revision before it can be submitted for approval.' };
}

export function createLearningStore({ filePath } = {}) {
  if (!filePath) throw new Error('A persistent learning store filePath is required');
  async function read() {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'));
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.proposals) || !Array.isArray(parsed.versions)) throw new Error('Learning store has an unsupported format');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return clone(EMPTY);
      throw error;
    }
  }
  async function write(state) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = filePath + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, filePath);
  }
  return {
    async snapshot() {
      const state = await read();
      const active = state.versions.find((item) => item.id === state.activeVersionId) || null;
      return { schemaVersion: state.schemaVersion, sessions: state.sessions.slice(-30).reverse(), feedback: state.feedback.slice(-50).reverse(), proposals: state.proposals.slice(-30).reverse(), versions: state.versions.slice(-20).reverse(), activeVersion: active };
    },
    async recordSession({ id, mission, reports }) {
      const state = await read();
      const session = { id: boundedText(id, 'session id', 100), mission: boundedText(mission, 'mission', 1200), roles: Array.isArray(reports) ? reports.map((item) => boundedText(item?.role?.id || item?.role?.key || 'agent', 'role', 40, false)).slice(0, 5) : [], createdAt: new Date().toISOString() };
      state.sessions = state.sessions.filter((item) => item.id !== session.id);
      state.sessions.push(session);
      state.sessions = state.sessions.slice(-200);
      await write(state);
      return session;
    },
    async submitFeedback({ sessionId, rating, comment, improvement }) {
      const state = await read();
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) throw new Error('Unknown session id');
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('rating must be an integer from 1 to 5');
      const entry = { id: randomUUID(), sessionId, rating, comment: boundedText(comment || '', 'comment', 1200, false), createdAt: new Date().toISOString() };
      state.feedback.push(entry);
      state.feedback = state.feedback.slice(-500);
      let proposal = null;
      if (improvement && String(improvement).trim()) {
        const text = boundedText(improvement, 'improvement', 1200);
        proposal = { id: randomUUID(), sessionId, text, evaluation: evaluateProposal(text), status: 'pending', createdAt: new Date().toISOString(), decidedAt: null };
        state.proposals.push(proposal);
        state.proposals = state.proposals.slice(-200);
      }
      await write(state);
      return { feedback: entry, proposal };
    },
    async decideProposal({ proposalId, decision, reviewer }) {
      if (!['approve', 'reject'].includes(decision)) throw new Error('decision must be approve or reject');
      const state = await read();
      const proposal = state.proposals.find((item) => item.id === proposalId);
      if (!proposal) throw new Error('Unknown proposal id');
      if (proposal.status !== 'pending') throw new Error('Proposal has already been decided');
      if (decision === 'approve' && !proposal.evaluation.eligible) throw new Error('Proposal failed the quality gate and cannot be approved');
      proposal.status = decision === 'approve' ? 'approved' : 'rejected';
      proposal.reviewer = boundedText(reviewer || 'human reviewer', 'reviewer', 80);
      proposal.decidedAt = new Date().toISOString();
      if (decision === 'approve') {
        const previous = state.versions.find((item) => item.id === state.activeVersionId) || null;
        const version = { id: randomUUID(), number: state.versions.length + 1, guidance: proposal.text, sourceProposalId: proposal.id, previousVersionId: previous?.id || null, createdAt: new Date().toISOString(), status: 'active' };
        if (previous) previous.status = 'archived';
        state.versions.push(version);
        state.activeVersionId = version.id;
      }
      await write(state);
      return { proposal, activeVersion: state.versions.find((item) => item.id === state.activeVersionId) || null };
    },
    async rollback({ versionId, reviewer }) {
      const state = await read();
      if (!state.versions.length) throw new Error('There are no approved versions to roll back');
      const current = state.versions.find((item) => item.id === state.activeVersionId);
      const target = versionId ? state.versions.find((item) => item.id === versionId) : state.versions.find((item) => item.id === current?.previousVersionId);
      if (!target) throw new Error('No earlier approved version is available');
      if (current) current.status = 'archived';
      target.status = 'active';
      state.activeVersionId = target.id;
      state.rollbackEvents = [...(state.rollbackEvents || []), { from: current?.id || null, to: target.id, reviewer: boundedText(reviewer || 'human reviewer', 'reviewer', 80), createdAt: new Date().toISOString() }].slice(-100);
      await write(state);
      return { activeVersion: target, rollbackEvents: state.rollbackEvents };
    },
    async activeGuidance() {
      const state = await read();
      return state.versions.find((item) => item.id === state.activeVersionId)?.guidance || '';
    }
  };
}
