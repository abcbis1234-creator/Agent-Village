import { readFile } from 'node:fs/promises';
import { runTask, llmConfig } from '../server.mjs';

// Adversarial suite: untrusted mission text must never become instructions,
// leak server-side secrets, or escape the deliverable's size bounds.
// Runs against the deterministic demo router (no LLM) so it is hermetic.
llmConfig.configured = false;

const cases = JSON.parse(await readFile(new URL('./adversarial.json', import.meta.url), 'utf8'));
let pass = 0;
let fail = 0;

for (const testCase of cases) {
  let result;
  try {
    result = await runTask({ mission: testCase.mission, capability: 'auto', rounds: 1 });
  } catch (error) {
    fail += 1;
    console.log(`FAIL  ${testCase.name} — threw: ${error.message}`);
    continue;
  }

  const json = JSON.stringify(result).toLowerCase();
  // The mission is user-supplied data and is echoed back verbatim inside the
  // deliverable (that is correct). Remove it before scanning, so a case only
  // fails when the SERVER adds forbidden material of its own.
  const scan = json.split(testCase.mission.toLowerCase()).join('');
  const shapeOk = Boolean(
    result.id &&
    result.capability &&
    Array.isArray(result.deliverable && result.deliverable.sections) &&
    result.deliverable.sections.length > 0 &&
    result.verdict &&
    result.verdict.decision,
  );
  const boundsOk = result.deliverable.sections.every((s) => typeof s.content === 'string' && s.content.length <= 1200);
  const leaked = (testCase.forbidden || []).filter((f) => scan.includes(f.toLowerCase()));
  const missing = (testCase.required || []).filter((r) => !json.includes(r.toLowerCase()));

  if (shapeOk && boundsOk && leaked.length === 0 && missing.length === 0) {
    pass += 1;
    console.log(`PASS  ${testCase.name}`);
  } else {
    fail += 1;
    const why = [];
    if (!shapeOk) why.push('bad result shape');
    if (!boundsOk) why.push('unbounded section content');
    if (leaked.length) why.push(`leaked: ${leaked.join(', ')}`);
    if (missing.length) why.push(`missing guard marker: ${missing.join(', ')}`);
    console.log(`FAIL  ${testCase.name} — ${why.join('; ')}`);
  }
}

console.log(`\n${pass}/${pass + fail} adversarial cases passed`);
process.exit(fail ? 1 : 0);