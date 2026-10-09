// Database access, release-level migrations and the maintenance state the whole app checks.
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// DATE columns come back as 'YYYY-MM-DD' strings, never as JS Dates in the server's timezone.
pg.types.setTypeParser(1082, (v) => v);

const url = process.env.DATABASE_URL || '';
const viaPgVars = !url && !!process.env.PGHOST;
const sslmode = url ? new URL(url).searchParams.get('sslmode') : (process.env.PGSSLMODE || null);
const local = /localhost|127\.0\.0\.1/.test(url || process.env.PGHOST || '');
export const dbConfigured = !!(url || viaPgVars);
// The add-on allows about 16 connections per app role (measured 2026-10-09); 5 leaves room for the dashboard's SQL console.
export const pool = dbConfigured ? new pg.Pool({ ...(url ? { connectionString: url } : {}), max: 5, idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 3000, ssl: sslmode === 'disable' || local ? false : { rejectUnauthorized: false } }) : null;
if (pool) pool.on('error', (e) => console.error('[db] idle client error:', e.message));

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('begin'); const r = await fn(c); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}

/** Status the routes consult: null = fine; otherwise every page shows the generic unavailable screen. */
export const state = { maintenance: null, schemaVersion: null };

/** Apply every pending migration of this release in ONE transaction under an advisory lock. */
export async function migrate(dir = process.env.MIGRATIONS_DIR || 'migrations') {
  const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const known = files.map((f) => f.slice(0, 3));
  await q('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const applied = (await q('select version from schema_migrations order by version')).rows.map((r) => r.version);
  const unknown = applied.filter((v) => !known.includes(v));
  if (unknown.length) throw Object.assign(new Error(`database schema is newer than this release (has ${unknown.join(', ')})`), { code: 'SCHEMA_NEWER' });
  const pending = files.filter((f) => !applied.includes(f.slice(0, 3)));
  if (pending.length) {
    await tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(727001)');
      const again = (await c.query('select version from schema_migrations')).rows.map((r) => r.version);
      for (const f of pending) {
        if (again.includes(f.slice(0, 3))) continue;
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('insert into schema_migrations (version) values ($1)', [f.slice(0, 3)]);
      }
    });
  }
  state.schemaVersion = known.at(-1);
  return pending;
}

export async function getSettings(c = pool) {
  const rows = (await c.query('select key, value from settings')).rows;
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { company_name: '', company_address: '', company_email: '', company_phone: '', tax_label: 'Tax', tax_rate_bp: '0',
    tax_inclusive: '0', invoice_prefix: 'INV', invoice_footer: '', timezone: 'America/New_York', currency_symbol: '$', ...s };
}
export async function setSetting(c, key, value) {
  await c.query('insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, String(value ?? '')]);
}
export async function audit(c, user, action, entity, entityId, details) {
  await c.query('insert into audit_log (user_id, user_name, action, entity, entity_id, details) values ($1,$2,$3,$4,$5,$6)',
    [user?.id ?? null, user?.name ?? 'system', action, entity, String(entityId ?? ''), details ? JSON.stringify(details) : null]);
}
