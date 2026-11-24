#!/usr/bin/env node
// Validates the upgrade-idea catalog in docs/ideas.
// Zero dependencies. Run with: node scripts/ideas.mjs

import { readFile, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IDEAS_DIR = join(ROOT, 'docs', 'ideas');
const CATALOG_FILES = [
  ['01-orchestration.md', 'ORCH'],
  ['02-durability.md', 'DUR'],
  ['03-memory.md', 'MEM'],
  ['04-models-context.md', 'LLM'],
  ['05-tools-mcp.md', 'TOOL'],
  ['06-security.md', 'SEC'],
  ['07-evaluation.md', 'EVAL'],
  ['08-observability.md', 'OBS'],
  ['09-api-protocols.md', 'API'],
  ['10-ux.md', 'UX'],
  ['11-town.md', 'TOWN'],
  ['12-novel.md', 'NOVEL'],
];
const EFFORTS = new Set(['S', 'M', 'L']);

export function parseIdeas(markdown) {
  const rows = [];
  const errors = [];
  const lines = String(markdown).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-/.test(line)) continue; // separator row
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) continue;
    if (/^ID$/i.test(cells[0])) continue; // header row
    const match = cells[0].match(/^([A-Z]+)-(\d{3})$/);
    if (!match) continue;

    const row = {
      line: i + 1,
      id: cells[0],
      prefix: match[1],
      number: Number(match[2]),
      idea: cells[1] ?? '',
      detail: cells[2] ?? '',
      where: cells[3] ?? '',
      effort: cells[4] ?? '',
      source: cells[5] ?? '',
      columns: cells.length,
    };
    rows.push(row);
    if (cells.length !== 6) errors.push(`${row.id} line ${row.line}: expected 6 columns, found ${cells.length}`);
  }

  return { rows, errors };
}

export async function validateIdeas({ dir = IDEAS_DIR } = {}) {
  const errors = [];
  const warnings = [];
  const perFile = [];
  const seen = new Map();
  const titles = new Map();
  const sources = new Set();
  let total = 0;

  const sourceMd = await readFile(join(dir, 'SOURCES.md'), 'utf8');
  for (const line of sourceMd.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) sources.add(m[1]);
  }
  sources.add('Invented');

  for (const [file, expectedPrefix] of CATALOG_FILES) {
    let text;
    try {
      text = await readFile(join(dir, file), 'utf8');
    } catch {
      errors.push(`${file}: missing`);
      continue;
    }

    const title = text.match(/^#\s+.*?—\s*(\d+)\s+ideas/m);
    if (!title) errors.push(`${file}: title must end with "— N ideas"`);

    const { rows, errors: parseErrors } = parseIdeas(text);
    errors.push(...parseErrors.map((e) => `${file}: ${e}`));

    if (title && Number(title[1]) !== rows.length) {
      errors.push(`${file}: title says ${title[1]} ideas but table has ${rows.length}`);
    }
    if (rows.length === 0) errors.push(`${file}: no ideas found`);

    const numbers = rows.map((r) => r.number).sort((a, b) => a - b);
    for (let i = 0; i < numbers.length; i++) {
      if (numbers[i] !== i + 1) {
        errors.push(`${file}: numbering gap, expected ${String(i + 1).padStart(3, '0')} but found ${String(numbers[i]).padStart(3, '0')}`);
        break;
      }
    }

    const prefixes = new Set(rows.map((r) => r.prefix));
    if (prefixes.size > 1 || (prefixes.size === 1 && !prefixes.has(expectedPrefix))) {
      errors.push(`${file}: expected prefix ${expectedPrefix}, found ${[...prefixes].join(', ')}`);
    }

    for (const row of rows) {
      total++;
      if (seen.has(row.id)) errors.push(`${row.id}: duplicate id also used at ${seen.get(row.id)}`);
      else seen.set(row.id, `${file}:${row.line}`);

      if (!row.idea) errors.push(`${row.id}: empty idea title`);
      if (row.idea.length > 80) warnings.push(`${row.id}: title is ${row.idea.length} chars, consider shortening`);
      if (!row.detail) errors.push(`${row.id}: empty description`);
      if (!row.where) errors.push(`${row.id}: empty integration point`);
      if (!EFFORTS.has(row.effort)) errors.push(`${row.id}: effort must be S, M, or L (found "${row.effort}")`);
      if (!row.source) errors.push(`${row.id}: empty source`);
      else if (!sources.has(row.source) && row.source !== 'Invented') {
        errors.push(`${row.id}: unknown source key "${row.source}" (add it to SOURCES.md or use Invented)`);
      }

      const key = row.idea.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (titles.has(key)) warnings.push(`${row.id}: same title as ${titles.get(key)}`);
      else titles.set(key, row.id);
    }

    perFile.push({ file, prefix: expectedPrefix, count: rows.length, declared: title ? Number(title[1]) : null });
  }

  const present = new Set((await readdir(dir)).filter((f) => f.endsWith('.md')));
  for (const [file] of CATALOG_FILES) present.delete(file);
  present.delete('README.md');
  present.delete('SOURCES.md');
  for (const extra of present) warnings.push(`unexpected markdown file in docs/ideas: ${extra}`);

  if (total < 1000) errors.push(`catalog has ${total} ideas, need at least 1000`);

  return { ok: errors.length === 0, total, perFile, errors, warnings };
}

async function main() {
  const result = await validateIdeas();
  let width = 4;
  for (const f of result.perFile) width = Math.max(width, String(f.count).length);

  console.log('Category            Prefix  Ideas');
  console.log('------------------- ------  -----');
  for (const f of result.perFile) {
    console.log(`${basename(f.file).padEnd(19)} ${f.prefix.padEnd(6)}  ${String(f.count).padStart(width)}`);
  }
  console.log('------------------- ------  -----');
  console.log(`${'TOTAL'.padEnd(19)} ${''.padEnd(6)}  ${String(result.total).padStart(width)}`);

  if (result.warnings.length) {
    console.log(`\n${result.warnings.length} warning(s):`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
  if (result.errors.length) {
    console.error(`\n${result.errors.length} error(s):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nCatalog OK');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
