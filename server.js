import { readFileSync, writeFileSync, existsSync, createReadStream } from 'fs';
import { createServer } from 'http';
import { join, extname } from 'path';

const PORT = 3456;
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

const server = createServer(async (req, res) => {
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
