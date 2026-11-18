import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_PATCH_CHARS = 40000;
const MAX_FILES = 10;
const ALLOWED_ROOTS = ['studio/', 'public/', 'test/', 'docs/'];
const DENIED_PATHS = /(^|\/)(\.env(?:\.|$)|secrets?(?:\/|$)|credentials?(?:\/|$)|node_modules|\.git)(\/|$)/i;
const EMPTY = { schemaVersion: 1, proposals: [] };

function text(value, field, max, required = true) {
  if (typeof value !== 'string') throw new Error(field + ' must be text');
  const result = value.trim();
  if (required && !result) throw new Error(field + ' is required');
  if (result.length > max) throw new Error(field + ' must be ' + max + ' characters or fewer');
  return result;
}

function safePath(value) {
  const path = text(value, 'file path', 240);
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Unsafe file path: ' + path);
  }
  if (DENIED_PATHS.test(path) || !ALLOWED_ROOTS.some((root) => path.startsWith(root))) {
    throw new Error('File path is outside the code-evolution allowlist: ' + path);
  }
  return path;
}

function inspectPatch(patch, files) {
  if (!patch || !patch.includes('--- ') || !patch.includes('+++ ')) throw new Error('patch must be a unified diff with file headers');
  if (/\0/.test(patch) || /GIT binary patch|Binary files .* differ/.test(patch)) throw new Error('Binary patches are not supported');
  const headers = [...patch.matchAll(/^(?:\+\+\+|---) (?:a\/|b\/)?([^\t\n]+)$/gm)].map((match) => match[1]);
  const normalized = [...new Set(headers.filter((path) => path !== '/dev/null').map(safePath))];
  if (!normalized.length || normalized.some((path) => !files.includes(path)) || files.some((path) => !normalized.includes(path))) {
    throw new Error('Patch headers must match the declared file list exactly');
  }
  const checks = {
    bounded: patch.length <= MAX_PATCH_CHARS,
    allowlisted: true,
    textOnly: true,
    hasHunks: /^@@ /m.test(patch)
  };
  return { checks, eligible: Object.values(checks).every(Boolean), note: 'Structural checks only. Passing does not establish correctness, security, or test success.' };
}

export function createCodeEvolutionStore({ filePath } = {}) {
  if (!filePath) throw new Error('A persistent code-evolution filePath is required');
  let queue = Promise.resolve();
  async function read() {
    try {
      const state = JSON.parse(await readFile(filePath, 'utf8'));
      if (state.schemaVersion !== 1 || !Array.isArray(state.proposals)) throw new Error('Code-evolution store has an unsupported format');
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(EMPTY);
      throw error;
    }
  }
  async function write(state) {
    await mkdir(dirname(filePath), { recursive: true });
    const temporary = filePath + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, filePath);
  }
  function serialize(operation) {
    const next = queue.then(operation, operation);
    queue = next.then(() => undefined, () => undefined);
    return next;
  }
  return {
    async list() {
      const state = await read();
      return state.proposals.slice(-100).reverse();
    },
    submit({ mission, rationale, files, patch, author = 'agent' } = {}) {
      return serialize(async () => {
        const goal = text(mission, 'mission', 1200);
        const reason = text(rationale, 'rationale', 2000);
        const source = text(patch, 'patch', MAX_PATCH_CHARS);
        if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) throw new Error('files must contain between 1 and 10 paths');
        const paths = [...new Set(files.map(safePath))];
        if (paths.length !== files.length) throw new Error('files must not contain duplicates');
        const evaluation = inspectPatch(source, paths);
        const proposal = {
          id: randomUUID(), mission: goal, rationale: reason, files: paths,
          patch: source, author: text(author, 'author', 80), evaluation,
          status: 'pending_review', createdAt: new Date().toISOString(),
          reviewedAt: null, reviewer: null, reviewNote: null
        };
        const state = await read();
        state.proposals.push(proposal);
        state.proposals = state.proposals.slice(-300);
        await write(state);
        return proposal;
      });
    },
    review({ proposalId, decision, reviewer, note = '' } = {}) {
      return serialize(async () => {
        if (!['approve', 'reject'].includes(decision)) throw new Error('decision must be approve or reject');
        const state = await read();
        const proposal = state.proposals.find((item) => item.id === proposalId);
        if (!proposal) throw new Error('Unknown code-change proposal');
        if (proposal.status !== 'pending_review') throw new Error('Proposal has already been reviewed');
        if (decision === 'approve' && !proposal.evaluation.eligible) throw new Error('Proposal failed structural checks');
        proposal.status = decision === 'approve' ? 'approved_for_manual_application' : 'rejected';
        proposal.reviewer = text(reviewer, 'reviewer', 80);
        proposal.reviewNote = text(note, 'review note', 1200, false);
        proposal.reviewedAt = new Date().toISOString();
        await write(state);
        return proposal;
      });
    }
  };
}
