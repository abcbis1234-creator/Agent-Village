import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const setPlacement = {
  street: { x: 540, y: 1650, z: 1, scale: 1 },
  kitchen: { x: 540, y: 1600, z: 1, scale: 1 },
  office: { x: 540, y: 1300, z: 1.2, scale: 1 },
  shop_counter: { x: 560, y: 1330, z: 1.6, scale: 1 },
  planet_shop: { x: 640, y: 1290, z: 1.04, scale: 1 },
  ship_deck: { x: 540, y: 1650, z: 1, scale: 1 },
  desert_rails: { x: 540, y: 1800, z: 0.98, scale: 1 },
  castle_hall: { x: 540, y: 1600, z: 1, scale: 1 },
  field: { x: 540, y: 1950, z: 0.9, scale: 1 },
  town_top: { x: 300, y: 1300, z: 0.92, scale: 0.28 },
  prehistoric: { x: 540, y: 1650, z: 1, scale: 1 }
};

function normalizeWord(value) {
  return String(value).toLocaleLowerCase('en').replace(/[^\p{L}\p{N}'’]/gu, '');
}

export function scriptTokens(script) {
  return String(script || '').replace(/\r/g, '').split(/\s+/).filter(Boolean);
}

export function findSceneStartWord(narration, tokens, afterIndex = -1) {
  const target = scriptTokens(narration).map(normalizeWord).filter(Boolean);
  if (!target.length) throw new Error('scene narration must contain at least one word');
  const normalized = tokens.map(normalizeWord);
  for (let i = Math.max(0, afterIndex + 1); i <= normalized.length - target.length; i += 1) {
    if (target.every((word, offset) => normalized[i + offset] === word)) return i;
  }
  throw new Error('each scene narration must appear in the script in the same order; check punctuation and wording');
}

export function buildToon2dStoryboard(project, wordRows) {
  if (!project || !Array.isArray(project.scenes) || !project.scenes.length) throw new Error('project needs storyboard scenes');
  if (!Array.isArray(wordRows) || !wordRows.length) throw new Error('toon2d word timings are missing');
  const tokens = wordRows.map((row) => row.w);
  const scriptWordCount = scriptTokens(project.script).length;
  if (tokens.length !== scriptWordCount) throw new Error('toon2d word timings do not match the narration script');

  let previousStart = -1;
  const scenes = project.scenes.map((scene, index) => {
    const startWord = findSceneStartWord(scene.narration, tokens, previousStart);
    if (startWord <= previousStart) throw new Error('scene narration must be in script order without duplicate starts');
    previousStart = startWord;
    const placement = setPlacement[scene.set] || setPlacement.field;
    const actor = {
      id: 'hero',
      type: scene.characterType || 'scientist',
      x: placement.x,
      y: placement.y,
      scale: placement.scale,
      z: placement.z,
      dir: 1,
      pose: scene.pose || 'stand',
      expr: scene.expression || 'neutral'
    };
    return {
      id: `scene-${index + 1}`,
      start_word: startWord,
      set: scene.set || 'field',
      mood: scene.mood || 'day',
      cast: [actor],
      keys: [{ w: startWord, frame: 'hero' }],
      acts: []
    };
  });

  const lastWordEnd = Number(wordRows[wordRows.length - 1].e);
  const endPad = Number((project.targetSeconds - lastWordEnd).toFixed(3));
  if (!Number.isFinite(endPad) || endPad < 0 || endPad > 10) throw new Error('script timing does not fit the target duration');

  return {
    title: project.title,
    fps: 30,
    end_pad: endPad,
    lowercase: true,
    _words: tokens.map((word, index) => `${index} ${word}`).join(' | '),
    scenes
  };
}

function runPython(python, engineHome, projectDir, args) {
  const cli = join(engineHome, 't2d.py');
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(python, [cli, args[0], projectDir, ...args.slice(1)], {
      cwd: engineHome,
      env: { ...process.env, PYTHONUTF8: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-100000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-100000); });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`toon2d ${args[0]} failed (${code}): ${(stderr || stdout).trim().slice(-2000)}`));
    });
  });
}

export async function prepareToon2dProject(project, options = {}) {
  if (!project || project.status !== 'approved') throw new Error('project must be human-approved before renderer preparation');
  if (!project.script || !project.scenes?.length) throw new Error('project needs a script and storyboard scenes');

  const engineHome = resolve(options.engineHome || process.env.TOON2D_HOME || join(root, 'vendor', 'toon2d-shorts'));
  const python = options.python || process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
  const cli = join(engineHome, 't2d.py');
  try { await stat(cli); } catch { throw new Error('toon2d engine not found; set TOON2D_HOME to the extracted toon2d-shorts folder'); }

  const projectDir = join(root, 'data', 'toon2d-projects', project.id);
  await mkdir(projectDir, { recursive: true });
  await writeFile(join(projectDir, 'script.txt'), project.script.trim() + '\n', 'utf8');

  const silent = await runPython(python, engineHome, projectDir, ['silent', '--script', 'script.txt', '--duration', String(project.targetSeconds)]);
  const wordRows = JSON.parse(await readFile(join(projectDir, 'words.json'), 'utf8'));
  const storyboard = buildToon2dStoryboard(project, wordRows);
  await writeFile(join(projectDir, 'storyboard.json'), JSON.stringify(storyboard, null, 2) + '\n', 'utf8');

  const planned = await runPython(python, engineHome, projectDir, ['plan']);
  const plan = JSON.parse(await readFile(join(projectDir, 'plan.json'), 'utf8'));
  return {
    engine: 'toon2d-shorts',
    status: 'prepared',
    durationSeconds: plan.duration,
    sceneCount: plan.scenes.length,
    wordCount: wordRows.length,
    projectDirectory: projectDir,
    planSummary: planned.stdout.trim(),
    narrationMode: 'captions-only',
    notes: [silent.stdout.trim(), 'No MP4 has been rendered yet. Run the render and join stages after reviewing stills.']
  };
}
