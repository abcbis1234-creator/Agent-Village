/**
 * Post-render Pexels picture-in-picture compositor.
 * Keeps the original Toon2D render, captions, and audio intact; Pexels footage
 * appears as a timed vertical inset over the corresponding storyboard scene.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_CLIP_BYTES = 120 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30000;
const FFMPEG_TIMEOUT_MS = 180000;
const INSET_WIDTH = 520;
const INSET_HEIGHT = 920;
const INSET_Y = 360;

export function isAllowedPexelsVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'pexels.com' || url.hostname.endsWith('.pexels.com'));
  } catch {
    return false;
  }
}

export function planCompositeSegments(plan, projectScenes) {
  if (!plan || !Array.isArray(plan.scenes) || !Array.isArray(projectScenes)) {
    throw new Error('A Toon2D plan and matching project scenes are required');
  }
  if (plan.scenes.length !== projectScenes.length || !plan.scenes.length) {
    throw new Error('Toon2D plan scenes must match the approved storyboard');
  }
  let previousEnd = 0;
  return plan.scenes.map((scene, index) => {
    const start = Number(scene.t0);
    const end = Number(scene.t1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd - 0.05 || end <= start) {
      throw new Error('Toon2D scene timings are invalid or overlap');
    }
    previousEnd = end;
    const footage = projectScenes[index]?.footage;
    return {
      index,
      start,
      duration: Number((end - start).toFixed(3)),
      footage: footage && isAllowedPexelsVideoUrl(footage.videoUrl) ? footage : null
    };
  });
}

async function downloadPexelsClip(url, destination, fetchImpl = fetch) {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowedPexelsVideoUrl(current)) throw new Error('Pexels video URL must use HTTPS on a Pexels-owned host');
    const response = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'User-Agent': 'AgentVillage-ShortsStudio/2.0' }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('Pexels video redirect could not be followed safely');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Pexels clip download failed (${response.status})`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_CLIP_BYTES) throw new Error('Pexels clip exceeds the 120 MB download limit');
    let received = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (received > MAX_CLIP_BYTES) callback(new Error('Pexels clip exceeds the 120 MB download limit'));
        else callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (!received) throw new Error('Pexels returned an empty video file');
    return { bytes: received, finalUrl: current };
  }
  throw new Error('Pexels redirect limit exceeded');
}

function run(command, args, timeoutMs = FFMPEG_TIMEOUT_MS) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', (error) => { clearTimeout(timer); rejectPromise(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stderr });
      else rejectPromise(new Error(`FFmpeg failed (${code ?? signal}): ${stderr.trim().slice(-3000)}`));
    });
  });
}

async function resolveFfmpeg(options = {}) {
  if (options.ffmpegPath) return options.ffmpegPath;
  if (process.env.TOON2D_FFMPEG) return process.env.TOON2D_FFMPEG;
  const python = options.python || process.env.PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3');
  try {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { stdio: ['ignore', 'pipe', 'ignore'] });
      let output = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', rejectPromise);
      child.on('close', (code) => code === 0 && output.trim() ? resolvePromise(output.trim()) : rejectPromise(new Error('imageio-ffmpeg is unavailable')));
    });
    return result;
  } catch {
    return 'ffmpeg';
  }
}

function safeConcatPath(name) {
  return name.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

export async function compositePexelsFootage(project, options = {}) {
  if (!project || project.status !== 'approved') throw new Error('Project must be approved before video compositing');
  const projectDir = resolve(options.projectDir || join(ROOT, 'data', 'toon2d-projects', project.id));
  const baseVideo = join(projectDir, 'final.mp4');
  const planPath = join(projectDir, 'plan.json');
  await stat(baseVideo).catch(() => { throw new Error('Toon2D final.mp4 is missing. Render all chunks and run the Toon2D join step first.'); });
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  const segments = planCompositeSegments(plan, project.scenes);
  const ffmpeg = await resolveFfmpeg(options);
  const workDir = join(projectDir, 'pexels-composite');
  await mkdir(workDir, { recursive: true });
  const segmentFiles = [];
  const results = [];

  for (const segment of segments) {
    const outputName = `scene-${String(segment.index + 1).padStart(2, '0')}.mp4`;
    const outputPath = join(workDir, outputName);
    let clipPath = null;
    let usedFootage = false;
    let fallbackReason = null;

    if (segment.footage) {
      try {
        clipPath = join(workDir, `source-${String(segment.index + 1).padStart(2, '0')}.mp4`);
        await unlink(clipPath).catch(() => {});
        await downloadPexelsClip(segment.footage.videoUrl, clipPath, options.fetch || fetch);
        usedFootage = true;
      } catch (error) {
        fallbackReason = error.message;
        clipPath = null;
      }
    }

    const start = segment.start.toFixed(3);
    const duration = segment.duration.toFixed(3);
    const common = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', start, '-t', duration, '-i', baseVideo];
    if (clipPath) {
      const filter = `[1:v]scale=${INSET_WIDTH}:${INSET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${INSET_WIDTH}:${INSET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.9:t=5[broll];[0:v][broll]overlay=(W-w)/2:${INSET_Y}:shortest=1:format=auto[v]`;
      await run(ffmpeg, [
        ...common, '-stream_loop', '-1', '-i', clipPath,
        '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
        '-t', duration, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-ar', '48000', '-movflags', '+faststart', outputPath
      ], options.ffmpegTimeoutMs || FFMPEG_TIMEOUT_MS);
    } else {
      await run(ffmpeg, [
        ...common, '-map', '0:v:0', '-map', '0:a?',
        '-t', duration, '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast',
        '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
        '-ar', '48000', '-movflags', '+faststart', outputPath
      ], options.ffmpegTimeoutMs || FFMPEG_TIMEOUT_MS);
    }
    segmentFiles.push(outputName);
    results.push({ scene: segment.index + 1, usedPexels: usedFootage, fallbackReason });
  }

  const concatList = join(workDir, 'segments.txt');
  await (await import('node:fs/promises')).writeFile(
    concatList,
    segmentFiles.map((name) => `file '${safeConcatPath(name)}'`).join('\n') + '\n',
    'utf8'
  );
  const silentComposite = join(workDir, 'composite-video.mp4');
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
    '-i', concatList, '-c', 'copy', silentComposite
  ], options.ffmpegTimeoutMs || FFMPEG_TIMEOUT_MS);

  const outputPath = join(projectDir, 'final-pexels.mp4');
  const temporaryOutput = join(projectDir, 'final-pexels.tmp.mp4');
  await run(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', silentComposite, '-i', baseVideo,
    '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'copy', '-c:a', 'aac',
    '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart',
    temporaryOutput
  ], options.ffmpegTimeoutMs || FFMPEG_TIMEOUT_MS);
  await rename(temporaryOutput, outputPath);
  return {
    status: 'composited',
    outputPath,
    durationSeconds: Number(plan.duration),
    sceneCount: segments.length,
    footageScenes: results.filter((item) => item.usedPexels).length,
    fallbackScenes: results.filter((item) => !item.usedPexels).length,
    scenes: results
  };
}
