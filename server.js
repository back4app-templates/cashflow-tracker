// File: server.js · Node 22 · Express 5 — bootstrap build: proves the container and the PostgreSQL add-on talk to each other.
import express from 'express';
import pg from 'pg';

const PORT = Number(process.env.PORT) || 8080;
const url = process.env.DATABASE_URL;
const pool = url ? new pg.Pool({ connectionString: url, ssl: /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false } }) : null;

const app = express();
app.get('/healthz', async (req, res) => {
  const out = { ok: true, version: '0.0.1', database: pool ? 'configured' : 'missing DATABASE_URL' };
  if (pool) {
    try { const r = await pool.query('select version() as v, now() as now'); out.postgres = r.rows[0].v.split(' ').slice(0, 2).join(' '); out.now = r.rows[0].now; }
    catch (e) { out.ok = false; out.error = e.message; }
  }
  res.status(out.ok ? 200 : 500).json(out);
});
app.get('/', (req, res) => res.type('html').send('<h1>Firmbook</h1><p>Bootstrap build. Check <a href="/healthz">/healthz</a>.</p>'));
app.listen(PORT, () => console.log(`firmbook 0.0.1 on :${PORT} (database ${pool ? 'configured' : 'not configured'})`));
