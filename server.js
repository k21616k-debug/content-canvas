import { readFileSync, writeFileSync, existsSync, createReadStream, mkdirSync, renameSync, readdirSync, statSync } from 'fs';
import { createServer } from 'http';
import { join, extname } from 'path';
import { execSync, spawn } from 'child_process';
import expandHandler from './api/expand.js';
import reviewHandler from './api/review.js';
import askHandler from './api/ask.js';
import planHandler from './api/plan.js';
import briefHandler from './api/brief.js';
import classifyHandler from './api/classify.js';
import scriptHandler from './api/script.js';
import { getUsage } from './api/_usage.js';

const GIT_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim(); }
  catch { return 'unknown'; }
})();
const START_TIME = new Date().toISOString();

const PORT = process.env.PORT || 3456;
const DATA_DIR = join(import.meta.dirname, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Resolve a per-project data file, guarded against path traversal (projectId comes from the
// client). Returns null for a bad id so the caller can 400 instead of writing anywhere.
function projectFile(id) {
  return /^[A-Za-z0-9_-]+$/.test(id || '') ? join(DATA_DIR, id + '.json') : null;
}

// Runtime auto-backup: after a save, schedule a git commit of data/ off the response path so
// save latency is never affected. A 10s debounce coalesces a burst of saves into ONE commit.
// Non-blocking spawn (NOT execSync) so the event loop is never blocked while git runs.
let _backupTimer = null;
function scheduleBackup() {
  clearTimeout(_backupTimer);
  _backupTimer = setTimeout(() => {
    spawn('sh', ['-c',
      'git add data/ && git -c user.name=auto -c user.email=auto@local commit -q -m "autosave: $(date +%H:%M:%S)" --only data/ || true'
    ], { cwd: import.meta.dirname, stdio: 'ignore', detached: true }).unref();
  }, 10000);
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

// Adapt Node.js raw req/res to Vercel-style handler convention
async function routeApi(handler, rawReq, rawRes) {
  const body = await readBody(rawReq);
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}

  const req = { method: rawReq.method, body: parsed };
  let statusCode = 200;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) {
      rawRes.writeHead(statusCode, { 'Content-Type': 'application/json' });
      rawRes.end(JSON.stringify(data));
    },
  };

  await handler(req, res);
}

const server = createServer(async (req, res) => {
  // Usage stats
  if (req.method === 'GET' && req.url === '/api/usage') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getUsage()));
    return;
  }

  // Version info
  if (req.method === 'GET' && req.url === '/api/version') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commit: GIT_HASH, env: 'local', time: START_TIME }));
    return;
  }

  // AI endpoints
  if (req.method === 'POST' && req.url === '/api/plan') {
    await routeApi(planHandler, req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/expand') {
    await routeApi(expandHandler, req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/review') {
    await routeApi(reviewHandler, req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/ask') {
    await routeApi(askHandler, req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/brief') {
    await routeApi(briefHandler, req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/classify') {
    await routeApi(classifyHandler, req, res);
    return;
  }
  if (req.method === 'POST' && req.url === '/api/script') {
    await routeApi(scriptHandler, req, res);
    return;
  }

  // Save canvas data — one file per project (data/{projectId}.json) so projects never
  // overwrite each other, written atomically (tmp + rename) so a crash can't leave a half file.
  // projectId is REQUIRED: without a valid one we 400 rather than write the legacy single file,
  // so the single source of truth stays the per-project files in data/.
  if (req.method === 'POST' && req.url === '/api/save') {
    const body = await readBody(req);
    try {
      let projectId = null;
      try { projectId = JSON.parse(body).projectId; } catch {}
      const target = projectFile(projectId);
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid projectId"}');
        return;
      }
      const tmp = target + '.tmp';
      writeFileSync(tmp, body, 'utf8');
      renameSync(tmp, target);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      scheduleBackup();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // List projects — the authoritative project list, read from the data/ directory (the single
  // source of truth) so the dropdown survives a browser-cache clear. One entry per data/*.json.
  if (req.method === 'GET' && req.url.startsWith('/api/projects')) {
    try {
      const files = readdirSync(DATA_DIR).filter(
        (f) => f.endsWith('.json') && !f.endsWith('.tmp') && !f.endsWith('.bak')
      );
      const projects = files.map((f) => {
        const id = f.slice(0, -'.json'.length);
        const full = join(DATA_DIR, f);
        let name = id;
        let nodeCount = 0;
        try {
          const d = JSON.parse(readFileSync(full, 'utf8'));
          // nodes is a serialized Map: an array of [nodeId, nodeObject] pairs.
          const nodes = d.nodes || [];
          nodeCount = nodes.length;
          name = d.projectName || nodes[0]?.[1]?.main?.topic || id;
        } catch {}
        return { id, name, nodeCount, updatedAt: statSync(full).mtime.toISOString() };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(projects));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Load canvas data — per project (?project={id}). No legacy fallback: without a valid project
  // id we return null so load can only ever read the durable per-project files in data/.
  if (req.method === 'GET' && req.url.startsWith('/api/data')) {
    const pid = new URL(req.url, 'http://localhost').searchParams.get('project');
    const target = projectFile(pid);
    if (target && existsSync(target)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      createReadStream(target).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('null');
    }
    return;
  }

  // Static files
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = join(import.meta.dirname, filePath);
  const ext = extname(filePath);

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Content Canvas running → http://localhost:${PORT}`);
});
