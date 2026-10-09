// File: server.js · Node 22 · Express 5 — bootstrap build: proves the container and the PostgreSQL add-on talk to each other
// and reports the add-on's shape for the platform gate. It never prints the password of DATABASE_URL.
import express from 'express';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;
const PORT = Number(process.env.PORT) || 8080;
const url = process.env.DATABASE_URL || '';
// Back4app also injects PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE; node-postgres reads those on its own when no
// connection string is given, so an empty DATABASE_URL (observed 2026-10-09) does not block the app.
const viaPgVars = !url && !!process.env.PGHOST;
const BOOT = new Date();

function shape(u) {
  if (!u) return null;
  try {
    const p = new URL(u);
    return { protocol: p.protocol, host: p.hostname, port: p.port || '(default)', database: p.pathname.slice(1), user: p.username,
      hasPassword: p.password.length > 0, params: Object.fromEntries(p.searchParams), length: u.length };
  } catch (e) { return { unparseable: true, length: u.length, error: e.message }; }
}
const sslmode = url ? new URL(url).searchParams.get('sslmode') : (process.env.PGSSLMODE || null);
const sslOpt = sslmode === 'disable' ? false : { rejectUnauthorized: false };
const base = url ? { connectionString: url } : {};
let pool = (url || viaPgVars) ? new pg.Pool({ ...base, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 3000, ssl: sslOpt }) : null;
let sslUsed = 'tls (rejectUnauthorized:false)';
// Some managed Postgres endpoints refuse TLS; if the first connection fails on SSL, retry once without it and say so.
if (pool) pool.query('select 1').catch(async (e) => {
  if (/ssl|tls/i.test(e.message)) { await pool.end().catch(() => {}); pool = new pg.Pool({ ...base, max: 5, ssl: false }); sslUsed = `plain (tls failed: ${e.message})`; }
});

const app = express();
app.get('/healthz', async (req, res) => {
  const out = { ok: true, version: VERSION, bootedAt: BOOT, uptimeSec: Math.round(process.uptime()),
    envKeys: Object.keys(process.env).filter((k) => /DATABASE|PG|POSTGRES|SQL|BACK4APP|B4A|COMMIT|GIT|SOURCE|DEPLOY/i.test(k)).sort(),
    database: pool ? (url ? 'configured via DATABASE_URL' : 'configured via PG* variables') : 'no DATABASE_URL and no PGHOST',
    databaseUrlShape: shape(url), databaseUrlEmptyButPresent: 'DATABASE_URL' in process.env && !url,
    pgVars: { host: process.env.PGHOST, port: process.env.PGPORT, database: process.env.PGDATABASE, user: process.env.PGUSER,
      hasPassword: !!process.env.PGPASSWORD, sslmode: process.env.PGSSLMODE || '(unset)' }, sslUsed };
  if (pool) {
    try {
      const r = await pool.query(`select version() as v, now() as now, current_user as u, current_database() as db,
        current_setting('max_connections') as max_conn, current_setting('server_version') as sv,
        (select count(*) from pg_stat_activity) as active,
        (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl,
        pg_database_size(current_database()) as bytes`);
      out.postgres = r.rows[0];
      await pool.query('create table if not exists gate_probe (id serial primary key, booted_at timestamptz not null default now(), version text)');
      if (!app.locals.probed) { await pool.query('insert into gate_probe (booted_at, version) values ($1, $2)', [BOOT, VERSION]); app.locals.probed = true; }
      const p = await pool.query('select count(*)::int as boots, min(booted_at) as first_boot, max(booted_at) as last_boot from gate_probe');
      out.persistence = p.rows[0];
    } catch (e) { out.ok = false; out.error = e.message; }
  }
  res.status(out.ok ? 200 : 500).json(out);
});
// Opens up to ?n= connections one by one and reports where the server stops accepting them (gate: connection limit).
app.get('/gate/connections', async (req, res) => {
  if (!pool) return res.status(400).json({ error: 'no database' });
  const n = Math.min(Number(req.query.n) || 30, 200), clients = [];
  let reached = 0, error = null;
  try {
    for (let i = 0; i < n; i++) {
      const c = new pg.Client({ ...base, ssl: pool.options.ssl, connectionTimeoutMillis: 5000 });
      await c.connect(); clients.push(c); reached++;
    }
  } catch (e) { error = e.message; }
  finally { await Promise.allSettled(clients.map((c) => c.end())); }
  res.json({ requested: n, opened: reached, error });
});
app.get('/', (req, res) => res.type('html').send(`<h1>Firmbook</h1><p>Bootstrap build ${VERSION}. Check <a href="/healthz">/healthz</a>.</p>`));
app.listen(PORT, () => console.log(`firmbook ${VERSION} on :${PORT} (database ${pool ? 'configured' : 'not configured'})`));
