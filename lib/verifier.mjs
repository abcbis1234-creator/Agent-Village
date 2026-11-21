// Deterministic verifier — no LLM, just code checks.
// At least one verifier must be deterministic; every role being an LLM that says
// "looks good to me" is the classic MAST failure mode.

function evaluate(src) {
  const tokens = String(src).match(/\d+\.?\d*|[+\-*/()]/g) ?? [];
  if (tokens.length === 0) throw new Error('empty expression');
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => { if (tokens[i] !== t) throw new Error(`expected ${t}`); i += 1; };
  function expr() { let l = term(); while (peek() === '+' || peek() === '-') { const o = tokens[i]; i += 1; const r = term(); l = o === '+' ? l + r : l - r; } return l; }
  function term() { let l = factor(); while (peek() === '*' || peek() === '/') { const o = tokens[i]; i += 1; const r = factor(); l = o === '*' ? l * r : l / r; } return l; }
  function factor() {
    const t = tokens[i];
    if (t === '(') { i += 1; const v = expr(); eat(')'); return v; }
    if (t === '-') { i += 1; return -factor(); }
    if (t === '+') { i += 1; return factor(); }
    if (t !== undefined && /^\d/.test(t)) { i += 1; return parseFloat(t); }
    throw new Error(`unexpected token: ${t ?? 'end'}`);
  }
  const v = expr();
  if (i !== tokens.length) throw new Error('trailing input');
  if (!Number.isFinite(v)) throw new Error('result is not finite');
  return v;
}

export function verifyArithmetic(expression, claimedResult) {
  try {
    const actual = evaluate(expression);
    return Math.abs(actual - Number(claimedResult)) < 1e-9;
  } catch {
    return false;
  }
}

export function verifyNoSecrets(text) {
  const patterns = [/sk-/, /api[_-]?key/i, /bearer\s/i, /password/i, /secret/i];
  return !patterns.some((p) => p.test(text));
}

export function verifyToolResults(results) {
  const checks = [];
  let allPassed = true;

  for (const [tool, result] of Object.entries(results ?? {})) {
    const resultStr = String(result ?? '');
    if (resultStr.trim() === '') {
      checks.push({ name: `${tool}_non_empty`, pass: false, evidence: `Tool ${tool} returned empty result` });
      allPassed = false;
      continue;
    }
    if (/error|failed|exception/i.test(resultStr)) {
      checks.push({ name: `${tool}_no_error`, pass: false, evidence: `Tool ${tool} result contains error indicators` });
      allPassed = false;
      continue;
    }
    checks.push({ name: `${tool}_valid`, pass: true, evidence: `Tool ${tool} returned non-empty result` });
  }

  return { passed: allPassed, checks };
}

export function verifyRun({ toolResults, mission }) {
  const toolCheck = verifyToolResults(toolResults);
  const checks = [...toolCheck.checks];
  let passed = toolCheck.passed;

  const allText = Object.values(toolResults ?? {}).join(' ') + ' ' + String(mission ?? '');
  if (!verifyNoSecrets(allText)) {
    checks.push({ name: 'no_secrets', pass: false, evidence: 'Potential secret or credential detected in output' });
    passed = false;
  }

  return { passed, checks };
}
