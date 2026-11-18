import { readFile } from 'node:fs/promises';
import { runTask, llmConfig } from '../server.mjs';

llmConfig.configured = false;

const golden = JSON.parse(await readFile(new URL('./golden.json', import.meta.url), 'utf8'));
let pass = 0;
let fail = 0;

for (const { mission, expect } of golden) {
  const result = await runTask({ mission, capability: 'auto', rounds: 1 });
  const actual = result.capability.key;
  const shapeOk = Boolean(result.id && Array.isArray(result.reports) && result.reports.length > 0 && result.verdict && result.verdict.decision);
  if (actual === expect && shapeOk) {
    pass += 1;
    console.log(`PASS  ${expect.padEnd(14)} ${mission}`);
  } else {
    fail += 1;
    const why = actual !== expect ? `expected ${expect}, got ${actual}` : 'invalid result shape';
    console.log(`FAIL  ${expect.padEnd(14)} ${mission} — ${why}`);
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
