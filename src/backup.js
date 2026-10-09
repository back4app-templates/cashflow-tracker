// Backup = one zip: manifest.json + data/<table>.json, taken in a single REPEATABLE READ transaction. Sessions, reset tokens
// and one-time keys are never exported; a restore wipes every session.
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { audit } from './db.js';

export const TABLES = ['settings', 'users', 'recovery_codes', 'contacts', 'categories', 'invoice_counters', 'invoices', 'invoice_items', 'payments', 'allocations', 'bills', 'bill_payments', 'audit_log'];
const EXCLUDED_SETTINGS = ['reset_token_used', 'reset_token_used_at'];

export async function makeBackup(pool, { release, schemaVersion, user }) {
  const c = await pool.connect();
  try {
    await c.query('begin isolation level repeatable read read only');
    const files = {};
    let rows = 0;
    for (const t of TABLES) {
      const r = await c.query(t === 'settings' ? `select * from settings where key <> all($1::text[]) order by key` : `select * from ${t} order by 1`, t === 'settings' ? [EXCLUDED_SETTINGS] : []);
      files[`data/${t}.json`] = strToU8(JSON.stringify(r.rows));
      rows += r.rows.length;
    }
    files['manifest.json'] = strToU8(JSON.stringify({ app: 'firmbook', release, schema_version: schemaVersion, created_at: new Date().toISOString(), tables: TABLES, rows, excludes: ['sessions', 'idempotency_keys', 'bootstrap', ...EXCLUDED_SETTINGS] }, null, 2));
    await c.query('commit');
    await audit(pool, user, 'backup', 'backup', '', { rows });
    return { bytes: Buffer.from(zipSync(files, { level: 6 })), rows };
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

export function readBackup(buf) {
  const files = unzipSync(new Uint8Array(buf));
  if (!files['manifest.json']) throw Object.assign(new Error('Not a Firmbook backup: manifest.json is missing.'), { status: 400 });
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest.app !== 'firmbook') throw Object.assign(new Error('Not a Firmbook backup.'), { status: 400 });
  const data = {};
  for (const t of TABLES) data[t] = files[`data/${t}.json`] ? JSON.parse(strFromU8(files[`data/${t}.json`])) : [];
  return { manifest, data };
}

/** Replaces everything. Refuses a backup from a newer schema; marks bootstrap done on a first-run restore. */
export async function restoreBackup(c, { manifest, data }, { schemaVersion, user, firstRun }) {
  if (String(manifest.schema_version) > String(schemaVersion)) throw Object.assign(new Error(`This backup needs release schema ${manifest.schema_version}; this app has ${schemaVersion}. Update the app first.`), { status: 409 });
  await c.query('select pg_advisory_xact_lock(727002)');
  await c.query(`truncate ${[...TABLES, 'sessions', 'idempotency_keys'].join(', ')} restart identity cascade`);
  let rows = 0;
  for (const t of TABLES) {
    for (const row of data[t]) {
      const cols = Object.keys(row);
      await c.query(`insert into ${t} (${cols.map((k) => `"${k}"`).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
        cols.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k])));
      rows++;
    }
    const hasId = (await c.query(`select 1 from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = 'id'`, [t])).rows.length > 0;
    const seq = hasId ? (await c.query(`select pg_get_serial_sequence($1, 'id') as s`, [t])).rows[0]?.s : null;
    if (seq) await c.query(`select setval($1, coalesce((select max(id) from ${t}), 0) + 1, false)`, [seq]);
  }
  if (firstRun) await c.query('insert into bootstrap (id) values (1) on conflict do nothing');
  await audit(c, user, 'restore', 'backup', '', { rows, created_at: manifest.created_at, release: manifest.release });
  return rows;
}
