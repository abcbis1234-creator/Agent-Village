import {
  approveShortsProject,
  createShortsProject,
  getShortsProject,
  listShortsProjects,
  rejectShortsProject,
  submitShortsProject,
  updateShortsProject
} from './shorts-studio.mjs';
import { prepareToon2dProject } from './toon2d-adapter.mjs';
import { fetchBackgroundVideo, getCacheStats, purgeCache } from './pexels-service.mjs';
import { compositePexelsFootage } from './pexels-compositor.mjs';

function send(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(data);
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20000) throw new Error('request body is too large');
  }
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new Error('request body must be valid JSON'); }
}

export async function handleShortsApi(req, res, url) {
  if (!url.pathname.startsWith('/api/shorts/')) return false;
  try {
    if (req.method === 'GET' && url.pathname === '/api/shorts/cache') {
      send(res, 200, await getCacheStats());
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/shorts/cache/purge') {
      send(res, 200, await purgeCache());
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/shorts/projects') {
      return send(res, 200, { projects: await listShortsProjects() }), true;
    }
    if (req.method === 'POST' && url.pathname === '/api/shorts/projects') {
      return send(res, 201, { project: await createShortsProject(await readBody(req)) }), true;
    }

    const match = url.pathname.match(/^\/api\/shorts\/projects\/([a-f0-9-]+)(?:\/(submit|approve|reject|prepare-render|composite))?$/i);
    if (!match) {
      send(res, 404, { error: 'shorts_endpoint_not_found' });
      return true;
    }
    const [, id, action] = match;
    if (req.method === 'GET' && !action) {
      const project = await getShortsProject(id);
      send(res, project ? 200 : 404, project ? { project } : { error: 'project_not_found' });
      return true;
    }
    if (req.method === 'PATCH' && !action) {
      const project = await updateShortsProject(id, await readBody(req));
      send(res, project ? 200 : 404, project ? { project } : { error: 'project_not_found' });
      return true;
    }
    if (req.method === 'POST' && action) {
      const body = await readBody(req);
      const note = typeof body.note === 'string' ? body.note : '';
      if (action === 'composite') {
        const sourceProject = await getShortsProject(id);
        if (!sourceProject) {
          send(res, 404, { error: 'project_not_found' });
          return true;
        }
        if (sourceProject.status !== 'approved') {
          send(res, 409, { error: 'project_must_be_approved_before_compositing' });
          return true;
        }
        const footageOverrides = [];
        for (const scene of sourceProject.scenes) {
          const query = scene.brollQuery || scene.visual || sourceProject.topic;
          footageOverrides.push(await fetchBackgroundVideo(query));
        }
        const composition = await compositePexelsFootage(sourceProject, { footageOverrides });
        send(res, 200, { composition });
        return true;
      }
      if (action === 'prepare-render') {
        const sourceProject = await getShortsProject(id);
        if (!sourceProject) {
          send(res, 404, { error: 'project_not_found' });
          return true;
        }
        const preparation = await prepareToon2dProject(sourceProject);
        send(res, 200, { preparation });
        return true;
      }
      const actions = { submit: submitShortsProject, approve: approveShortsProject, reject: rejectShortsProject };
      const project = await actions[action](id, note);
      send(res, project ? 200 : 404, project ? { project } : { error: 'project_not_found' });
      return true;
    }
    send(res, 405, { error: 'method_not_allowed' });
    return true;
  } catch (error) {
    send(res, 400, { error: error.message || 'shorts_request_failed' });
    return true;
  }
}
