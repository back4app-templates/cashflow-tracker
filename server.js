// File: server.js · Node 22 · Express 5
// Serves the static app, exposes the public Parse keys from env vars, and answers the platform health check.
import express from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const required = ['APP_ID', 'JS_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')} — set them in Containers → Settings → Environment variables.`);
  process.exit(1);
}

const config = {
  appId: process.env.APP_ID,
  jsKey: process.env.JS_KEY,
  serverUrl: process.env.SERVER_URL || 'https://parseapi.back4app.com',
  demo: process.env.DEMO === 'true',
};

let commit = process.env.SOURCE_VERSION || process.env.GIT_COMMIT || '';
if (!commit) {
  try { commit = readFileSync(path.join(here, 'COMMIT'), 'utf8').trim(); } catch { commit = 'dev'; }
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (req, res) => {
  res.json({ ok: true, commit, uptime: Math.round(process.uptime()) });
});

app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.APP_CONFIG = ${JSON.stringify(config)};`);
});

app.use(express.static(path.join(here, 'public'), { extensions: ['html'], maxAge: '1h' }));

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

app.listen(PORT, () => {
  console.log(`cashflow-tracker listening on :${PORT} (commit ${commit}, demo=${config.demo})`);
});
