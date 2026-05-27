import { readFileSync, writeFileSync, existsSync, createReadStream } from 'fs';
import { createServer } from 'http';
import { join, extname } from 'path';
import { execSync } from 'child_process';
import expandHandler from './api/expand.js';
import reviewHandler from './api/review.js';
import askHandler from './api/ask.js';
import { getUsage } from './api/_usage.js';

const GIT_HASH = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: import.meta.dirname }).toString().trim(); }
  catch { return 'unknown'; }
})();
const START_TIME = new Date().toISOString();

const PORT = process.env.PORT || 3456;
const DATA_FILE = join(import.meta.dirname, 'canvas-data.json');

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

  // Save canvas data to file
  if (req.method === 'POST' && req.url === '/api/save') {
    const body = await readBody(req);
    try {
      writeFileSync(DATA_FILE, body, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Load canvas data from file
  if (req.method === 'GET' && req.url === '/api/data') {
    if (existsSync(DATA_FILE)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      createReadStream(DATA_FILE).pipe(res);
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
