// Owner-only: company and tax settings, users, sample data, backup/restore, audit log, custom/ interface check.
import { Router } from 'express';
import { pool, tx, audit, setSetting, state } from '../db.js';
import { hashPassword, revokeAllSessions, makeRecoveryCodes, once, consumeOnce, setFlash, requireRole, requireUser } from '../auth.js';
import { h, raw, field, input, select, hidden, button, form, badge, CUSTOM_INTERFACE } from '../render.js';
import { page, money } from '../page.js';
import { sampleCounts, sampleConflicts, addSampleData, removeSampleData } from '../sample.js';
import { makeBackup, readBackup, restoreBackup } from '../backup.js';
import { readMultipart } from './auth.js';
import { todayIn, fmtDate } from '../money.js';

export const router = Router();
const owner = requireRole('owner');
const RELEASE = process.env.npm_package_version || '0.1.0';

router.get('/settings', requireUser, async (req, res) => {
  const s = req.settings, u = req.user, custom = req.app.locals.custom;
  if (u.role !== 'owner') return page(req, res, { title: 'Settings', active: '/settings', body: h`<h1>Settings</h1><p>Only the owner can change settings. You are signed in as ${u.role}.</p><p><a href="/settings/password">Change your password</a></p>` });
  const users = (await pool.query('select id, email, name, role, created_at from users order by id')).rows;
  const counts = await sampleCounts(pool), conflicts = await sampleConflicts(pool), hasSample = Object.values(counts).some((n) => n > 0);
  const audits = (await pool.query('select * from audit_log order by id desc limit 30')).rows;
  const tz = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Lisbon', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
  const body = h`<h1>Settings</h1>
  ${custom.mismatch ? h`<div class="flash warn"><b>custom/ files follow interface ${custom.labelsVersion ?? '?'} / ${custom.themeVersion ?? '?'}; this release expects ${CUSTOM_INTERFACE}.</b> See custom/README.md in your repository and update the number after checking the changelog.</div>` : ''}
  <div class="cols"><section class="card"><h2>Company (printed on invoices)</h2>${form('/settings/company', u, once(), h`${field('Company name', input('company_name', s.company_name))}${field('Address', h`<textarea name="company_address" rows="3">${s.company_address}</textarea>`)}
    <div class="grid2">${field('E-mail', input('company_email', s.company_email))}${field('Phone', input('company_phone', s.company_phone))}</div>${field('Footer text on invoices', input('invoice_footer', s.invoice_footer))}
    <div class="grid2">${field('Timezone (decides "today")', select('timezone', tz.map((t) => [t, t]), s.timezone))}${field('Currency symbol', input('currency_symbol', s.currency_symbol, 'maxlength="4"'))}</div>${button('Save company')}`)}</section>
  <section class="card"><h2>Tax and numbering</h2>${form('/settings/tax', u, once(), h`<div class="grid2">${field('Tax label', input('tax_label', s.tax_label))}${field('Tax rate (%)', input('tax_rate', (Number(s.tax_rate_bp) / 100).toString(), 'inputmode="decimal"'))}</div>
    ${field('Prices you type are', select('tax_inclusive', [['0', 'before tax (tax is added)'], ['1', 'tax included (tax is extracted)']], s.tax_inclusive))}${field('Invoice number prefix', input('invoice_prefix', s.invoice_prefix, 'maxlength="8"'))}
    <p class="muted">Changes apply to new invoices only; an issued invoice keeps the tax it was issued with.</p>${button('Save tax settings')}`)}</section></div>
  <section class="card"><h2>People</h2><table><tr><th>Name</th><th>E-mail</th><th>Role</th><th></th></tr>${users.map((x) => h`<tr><td>${x.name}</td><td>${x.email}</td><td>${badge(x.role)}</td><td>${x.id !== u.id ? form(`/settings/users/${x.id}/remove`, u, once(), button('Remove', 'link danger'), 'class="inline" onsubmit="return confirm(\'Remove this person?\')"') : h`<a href="/settings/password">change password</a>`}</td></tr>`)}</table>
    <details><summary>Add a person</summary>${form('/settings/users', u, once(), h`<div class="grid2">${field('Name', input('name', '', 'required'))}${field('E-mail', input('email', '', 'type="email" required'))}${field('Temporary password (12+)', input('password', '', 'required minlength="12"'))}
      ${field('Role', select('role', [['staff', 'Staff — invoices, payments, contacts; no settings, no deleting'], ['demo', 'Demo — read-only'], ['owner', 'Owner — everything']]))}</div>${button('Add person')}`)}</details></section>
  <section class="card"><h2>Sample data</h2>${hasSample ? h`<p>${counts.contacts} contacts, ${counts.invoices} invoices, ${counts.payments} payments, ${counts.bills} bills are tagged as sample.</p>
    ${Object.values(conflicts).some((n) => n) ? h`<p class="warn">Removal is blocked: real records point at sample ones (${Object.entries(conflicts).filter(([, n]) => n).map(([k, n]) => `${k}: ${n}`).join(', ')}). Move or delete those first.</p>` : form('/settings/sample/remove', u, once(), button('Remove sample data (only tagged rows)', 'btn danger'), 'onsubmit="return confirm(\'Delete every row tagged as sample? Real records are kept.\')"')}`
    : form('/settings/sample/add', u, once(), h`<p>Fill the app with fictitious contacts, invoices, payments and bills to explore it. Everything added is tagged and can be removed with one click.</p>${button('Add sample data', 'btn ghost')}`)}</section>
  <section class="card"><h2>Backup and restore</h2><p>A backup is one file with everything (contacts, invoices, payments, bills, settings, people and their password hashes). Keep it where only you can read it — treat it like a bank statement. Sessions are never included.</p>
    <p>${form('/settings/backup', u, null, button('Download backup'), 'class="inline"')} ${form('/settings/export', u, null, button('Export CSVs (spreadsheets, not a backup)', 'btn ghost'), 'class="inline"')}</p>
    <details><summary>Restore from a backup file (replaces everything)</summary>${form('/settings/restore', u, once(), h`${field('Backup file', raw('<input type="file" name="file" accept=".zip" required>'))}${field('Type REPLACE to confirm', input('confirm', '', 'required'))}${button('Restore and sign everyone out', 'btn danger')}`, 'enctype="multipart/form-data"')}</details></section>
  <section class="card"><h2>About this deployment</h2><p>Release ${RELEASE} · schema ${state.schemaVersion} · custom interface ${CUSTOM_INTERFACE} · <a href="/healthz">health</a></p>
    <p class="muted">Before installing a template update: download a backup, then <i>Sync fork</i> on GitHub. If the app shows "temporarily unavailable" afterwards, use <i>Instant Rollback</i> in the Back4app dashboard — the database is not touched by a rollback.</p></section>
  <section class="card"><h2>Recent activity</h2><table>${audits.map((a) => h`<tr><td class="muted">${new Date(a.at).toISOString().replace('T', ' ').slice(0, 16)}</td><td>${a.user_name}</td><td>${a.action}</td><td>${a.entity} ${a.entity_id}</td><td class="muted">${a.details ? JSON.stringify(a.details) : ''}</td></tr>`)}</table></section>`;
  page(req, res, { title: 'Settings', body, active: '/settings', wide: true });
});

const save = (keys, fn) => async (req, res) => {
  await tx(async (c) => { if (!(await consumeOnce(c, req))) return; const vals = fn ? fn(req.body) : req.body; for (const k of keys) await setSetting(c, k, vals[k] ?? ''); await audit(c, req.user, 'settings', 'settings', keys.join(',')); });
  await setFlash(req, 'ok', 'Saved.'); res.redirect('/settings');
};
router.post('/settings/company', owner, save(['company_name', 'company_address', 'company_email', 'company_phone', 'invoice_footer', 'timezone', 'currency_symbol']));
router.post('/settings/tax', owner, save(['tax_label', 'tax_rate_bp', 'tax_inclusive', 'invoice_prefix'], (b) => ({ ...b, tax_rate_bp: Math.max(0, Math.round(Number(String(b.tax_rate || '0').replace(',', '.')) * 100)) || 0, tax_inclusive: b.tax_inclusive === '1' ? '1' : '0', invoice_prefix: (b.invoice_prefix || 'INV').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'INV' })));

router.post('/settings/users', owner, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name?.trim() || !/^[^@\s]+@[^@\s]+$/.test(email || '') || (password || '').length < 12 || !['staff', 'demo', 'owner'].includes(role)) { await setFlash(req, 'warn', 'Check name, e-mail, password (12+) and role.'); return res.redirect('/settings'); }
  try { await tx(async (c) => { if (!(await consumeOnce(c, req))) return; const r = await c.query('insert into users (email, name, password_hash, role) values ($1,$2,$3,$4) returning id', [email.trim().toLowerCase(), name.trim(), await hashPassword(password), role]); await audit(c, req.user, 'add-user', 'user', r.rows[0].id, { role }); }); await setFlash(req, 'ok', 'Person added.'); }
  catch (e) { if (e.code !== '23505') throw e; await setFlash(req, 'warn', 'That e-mail already exists.'); }
  res.redirect('/settings');
});
router.post('/settings/users/:id/remove', owner, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.redirect('/settings');
  await tx(async (c) => { if (!(await consumeOnce(c, req))) return; await c.query('delete from users where id = $1', [req.params.id]); await audit(c, req.user, 'remove-user', 'user', req.params.id); });
  res.redirect('/settings');
});
router.get('/settings/password', requireUser, (req, res) => page(req, res, { title: 'Change password', body: h`<h1>Change your password</h1>${form('/settings/password', req.user, once(), h`${field('New password (12+)', input('password', '', 'type="password" required minlength="12"'))}${button('Change password and sign out other sessions')}`)}
  <p class="muted">You will also get a fresh set of recovery codes.</p>` }));
router.post('/settings/password', requireUser, async (req, res) => {
  if ((req.body.password || '').length < 12 || req.user.role === 'demo') return res.redirect('/settings/password');
  const codes = await tx(async (c) => { if (!(await consumeOnce(c, req))) return null; await c.query('update users set password_hash = $2 where id = $1', [req.user.id, await hashPassword(req.body.password)]); await revokeAllSessions(c, req.user.id, req.user.sessionId); await audit(c, req.user, 'password-change', 'user', req.user.id); return makeRecoveryCodes(c, req.user.id); });
  if (!codes) return res.redirect('/settings');
  page(req, res, { title: 'Recovery codes', body: h`<h1>Password changed</h1><p>Other sessions were signed out. New recovery codes (the old ones no longer work):</p><pre class="codes">${codes.join('\n')}</pre><p><a class="btn" href="/settings">Back to Settings</a></p>` });
});

router.post('/settings/sample/add', owner, async (req, res) => {
  const out = await tx(async (c) => (await consumeOnce(c, req)) ? addSampleData(c, req.settings, todayIn(req.settings.timezone), req.user) : null);
  if (out) await setFlash(req, 'ok', `Added ${out.contacts} contacts, ${out.invoices} invoices, ${out.payments} payments, ${out.bills} bills.`);
  res.redirect('/');
});
router.post('/settings/sample/remove', owner, async (req, res) => {
  const out = await tx(async (c) => (await consumeOnce(c, req)) ? removeSampleData(c, req.user) : null);
  if (out) await setFlash(req, out.removed ? 'ok' : 'warn', out.removed ? 'Sample data removed.' : 'Removal blocked: real records point at sample rows.');
  res.redirect('/settings');
});

router.post('/settings/backup', owner, async (req, res) => {
  const { bytes } = await makeBackup(pool, { release: RELEASE, schemaVersion: state.schemaVersion, user: req.user });
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${new Date().toISOString().slice(0, 10)}.firmbook-backup.zip"`, 'Cache-Control': 'no-store' }).send(bytes);
});
router.post('/settings/export', owner, async (req, res) => {
  const { zipSync, strToU8 } = await import('fflate');
  const files = {};
  const csv = (rows) => { if (!rows.length) return ''; const cols = Object.keys(rows[0]); const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\n'); };
  const sets = { contacts: 'select id, name, email, phone, address, notes from contacts order by id',
    invoices: `select i.id, i.number, i.status, c.name as contact, i.issued_on, i.due_on, i.subtotal_cents/100.0 as subtotal, i.tax_cents/100.0 as tax, i.total_cents/100.0 as total from invoices i join contacts c on c.id = i.contact_id order by i.id`,
    invoice_items: 'select invoice_id, position, description, qty_milli/1000.0 as qty, unit_cents/100.0 as unit, net_cents/100.0 as net, tax_cents/100.0 as tax, gross_cents/100.0 as gross from invoice_items order by invoice_id, position',
    payments: `select p.id, p.paid_on, c.name as contact, p.direction, p.amount_cents/100.0 as amount, p.method, p.reference, p.notes from payments p join contacts c on c.id = p.contact_id order by p.id`,
    allocations: 'select a.payment_id, i.number as invoice, a.amount_cents/100.0 as amount from allocations a join invoices i on i.id = a.invoice_id order by a.id',
    bills: `select b.id, b.description, c.name as supplier, cat.name as category, b.due_on, b.status, b.amount_cents/100.0 as amount from bills b join contacts c on c.id = b.supplier_id left join categories cat on cat.id = b.category_id order by b.id`,
    bill_payments: 'select bill_id, paid_on, amount_cents/100.0 as amount, method, notes from bill_payments order by id' };
  for (const [name, sql] of Object.entries(sets)) files[`${name}.csv`] = strToU8(csv((await pool.query(sql)).rows));
  await audit(pool, req.user, 'export-csv', 'backup', '');
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${new Date().toISOString().slice(0, 10)}.firmbook-export.zip"` }).send(Buffer.from(zipSync(files)));
});
router.post('/settings/restore', owner, async (req, res) => {
  const { fields, file } = await readMultipart(req);
  if (fields._csrf !== req.user.csrf) return res.status(403).send('expired form');
  if (fields.confirm !== 'REPLACE' || !file) { await setFlash(req, 'warn', 'Type REPLACE and choose a file.'); return res.redirect('/settings'); }
  const parsed = readBackup(file);
  const rows = await tx(async (c) => { if (!(await consumeOnce(c, { body: fields, user: req.user }))) return null; return restoreBackup(c, parsed, { schemaVersion: state.schemaVersion, user: req.user, firstRun: false }); });
  res.clearCookie('fb_session', { path: '/' });
  page(req, res, { title: 'Restored', body: h`<h1>Backup restored</h1><p>${rows} rows from ${parsed.manifest.created_at}. Everyone was signed out, including you. <a class="btn" href="/login">Log in</a></p>` });
});
