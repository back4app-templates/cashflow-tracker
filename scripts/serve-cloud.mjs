// File: scripts/serve-cloud.mjs · dev helper: serves cloud/ read-only on localhost with CORS, so the dashboard editor
// can load the exact files from disk during a manual Cloud Code deploy. Not used in production.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cloud');
const port = Number(process.env.PORT) || 5179;
createServer((req, res) => {
  const name = path.basename(decodeURIComponent(req.url.split('?')[0]));
  const file = path.join(root, name);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!name || !existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
