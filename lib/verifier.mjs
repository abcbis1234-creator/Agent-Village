const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{30,}/,
  /github_pat_[a-zA-Z0-9_]{50,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export function verify({ message, toolResults }) {
  const findings = [];
  let severity = 'ok';

  for (const tr of toolResults) {
    if (!tr.ok) {
      findings.push({ kind: 'tool_error', tool: tr.tool, detail: tr.error });
      severity = severity === 'ok' ? 'warn' : severity;
      continue;
    }
    if (tr.tool === 'calculator') {
      const recheck = reEvaluate(tr.result);
      if (recheck === null) {
        findings.push({ kind: 'calc_unparseable', tool: tr.tool });
        severity = 'fail';
      }
    }
    const str = String(tr.result ?? '');
    for (const re of SECRET_PATTERNS) {
      if (re.test(str)) {
        findings.push({ kind: 'secret_leak', tool: tr.tool, pattern: re.source.slice(0, 20) });
        severity = 'fail';
      }
    }
  }

  return { severity, findings, toolCount: toolResults.length };
}

function reEvaluate(result) {
  const n = typeof result === 'number' ? result : Number(result);
  return Number.isFinite(n) ? n : null;
}