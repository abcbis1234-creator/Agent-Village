import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compositePexelsFootage } from '../studio/pexels-compositor.mjs';

test('returns the untouched Toon2D render when no Pexels footage is available', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'pexels-compositor-fallback-'));
  try {
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'final.mp4'), 'test video placeholder');
    await writeFile(join(projectDir, 'plan.json'), JSON.stringify({
      duration: 30,
      scenes: [{ t0: 0, t1: 10 }, { t0: 10, t1: 30 }]
    }));
    const result = await compositePexelsFootage({
      id: 'test-project',
      status: 'approved',
      scenes: [{ visual: 'Ocean' }, { visual: 'Space' }]
    }, { projectDir, footageOverrides: [null, null] });
    assert.equal(result.status, 'unchanged');
    assert.equal(result.outputPath, join(projectDir, 'final.mp4'));
    assert.equal(result.footageScenes, 0);
    assert.equal(result.fallbackScenes, 2);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
