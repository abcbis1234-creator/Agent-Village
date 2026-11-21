export function synthesize({ message, toolResults, verification }) {
  const lines = [];
  lines.push(`Request: ${message}`);
  lines.push('');
  if (toolResults.length === 0) {
    lines.push('Tools run: none');
  } else {
    lines.push('Tool results:');
    for (const tr of toolResults) {
      if (tr.ok) lines.push(`- ${tr.tool}: ${String(tr.result).slice(0, 300)}`);
      else lines.push(`- ${tr.tool} FAILED: ${tr.error}`);
    }
  }
  if (verification.findings.length > 0) {
    lines.push('');
    lines.push(`Verification severity: ${verification.severity}`);
    for (const f of verification.findings) {
      lines.push(`- ${f.kind}${f.tool ? ` (${f.tool})` : ''}${f.detail ? `: ${f.detail}` : ''}`);
    }
  }
  return lines.join('\n');
}