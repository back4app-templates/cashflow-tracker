// Firmbook — invoices, bills and a weekly money view for one small business. Node 22 + Express 5 + PostgreSQL.
import express from 'express';
import { readFileSync } from 'node:fs';
import { pool, dbConfigured, migrate, state, getSettings } from './src/db.js';
import { sessionMiddleware, csrfCheck } from './src/auth.js';
import { h, bare } from './src/render.js';
import { forbidden, refreshCustom } from './src/page.js';
import { router as authRoutes } from './src/routes/auth.js';
import { router as homeRoutes } from './src/routes/home.js';
import { router as invoiceRoutes } from './src/routes/invoices.js';
import { router as paymentRoutes } from './src/routes/payments.js';
import { router as contactRoutes } from './src/routes/contacts.js';
import { router as billRoutes } from './src/routes/bills.js';
import { router as settingsRoutes } from './src/routes/settings.js';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version;
process.env.npm_package_version ||= VERSION;
const PORT = Number(process.env.PORT) || 8080;
const BOOT = new Date();
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
refreshCustom(app);
app.locals.pages = { forbidden };

app.get('/healthz', async (req, res) => {
  const out = { ok: true, version: VERSION, bootedAt: BOOT, uptimeSec: Math.round(process.uptime()), schema: state.schemaVersion, maintenance: state.maintenance ? state.maintenance.kind : null };
  if (pool && !state.maintenance) {
    try { await pool.query('select 1'); out.database = 'ok';
      // Until the owner exists, say whether the setup passphrase reached the process (length only) — the first thing a reader needs to debug.
      if (!(await pool.query('select 1 from bootstrap where id = 1')).rows.length) out.firstRun = { setupSecret: process.env.SETUP_SECRET ? `set (${process.env.SETUP_SECRET.length} chars)` : 'missing' };
    } catch (e) { out.ok = false; out.database = 'unreachable'; }
  }
  else out.database = dbConfigured ? 'maintenance' : 'not configured';
  res.status(out.ok ? 200 : 503).json(out);
});
app.use('/static', express.static('public', { maxAge: '1h' }));
app.use('/custom', express.static('custom', { maxAge: '1h' }));
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' }); next(); });

/** The generic unavailable screen: no error text, no logs — those go to the runtime log the owner reads in the dashboard. */
app.use((req, res, next) => {
  if (!state.maintenance) return next();
  res.status(503).type('html').send(bare({ title: 'Temporarily unavailable', labels: app.locals.custom.labels, body: h`<h1>Temporarily unavailable</h1>
    <p>The app could not start correctly. If you just installed an update, open the Back4app dashboard: <b>Runtime logs</b> show the reason and <b>Instant Rollback</b> brings the previous version back. Your data is not affected.</p>` }));
});
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(sessionMiddleware);
app.use(csrfCheck);
app.use(async (req, res, next) => { req.settings = await getSettings(); next(); });
app.use(async (req, res, next) => {                                          // first run: everything goes to /setup
  if (req.path.startsWith('/setup') || req.path.startsWith('/share/')) return next();
  if (!(await pool.query('select 1 from bootstrap where id = 1')).rows.length) return res.redirect('/setup');
  next();
});
app.use(authRoutes); app.use(homeRoutes); app.use(invoiceRoutes); app.use(paymentRoutes); app.use(contactRoutes); app.use(billRoutes); app.use(settingsRoutes);
app.use((req, res) => res.status(404).type('html').send(bare({ title: 'Not found', labels: app.locals.custom.labels, body: h`<h1>Not found</h1><p><a href="/">Home</a></p>` })));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', req.method, req.path, err);
  res.status(status).type('html').send(bare({ title: status >= 500 ? 'Something went wrong' : 'Cannot do that', labels: app.locals.custom.labels,
    body: h`<h1>${status >= 500 ? 'Something went wrong' : 'Cannot do that'}</h1><p>${status >= 500 ? 'The error was written to the runtime log.' : err.message}</p><p><a href="javascript:history.back()">Go back</a></p>` }));
});

async function start() {
  if (!dbConfigured) { state.maintenance = { kind: 'no-database' }; console.error('[boot] no DATABASE_URL and no PGHOST: switch the PostgreSQL add-on on in the Back4app dashboard'); }
  else {
    try { const applied = await migrate(); console.log(`[boot] schema ${state.schemaVersion}${applied.length ? ` (applied ${applied.join(', ')})` : ''}`); }
    catch (e) { state.maintenance = { kind: e.code === 'SCHEMA_NEWER' ? 'schema-newer' : 'migration-failed', message: e.message }; console.error(`[boot] MIGRATION FAILED — serving the unavailable page. ${e.code === 'SCHEMA_NEWER' ? 'The database was migrated by a newer release; install that release again or restore a backup into a fresh deployment.' : 'Nothing was applied (the release migration rolled back). Use Instant Rollback in the dashboard or fix the migration.'}\n`, e); }
  }
  app.listen(PORT, () => console.log(`firmbook ${VERSION} on :${PORT}${state.maintenance ? ` [MAINTENANCE: ${state.maintenance.kind}]` : ''}`));
}
start();
