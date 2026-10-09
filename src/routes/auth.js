// First run (create owner / restore), login, logout, recovery codes, lost-access reset through the dashboard variable.
import { Router } from 'express';
import { pool, tx, audit, getSettings, setSetting } from '../db.js';
import { hashPassword, verifyPassword, createSession, setSessionCookie, revokeAllSessions, makeRecoveryCodes, useRecoveryCode, loginAllowed, loginFailed, once, consumeOnce, newToken, sha256, COOKIE } from '../auth.js';
import { h, raw, field, input, hidden, button, form } from '../render.js';
import { page, barePage } from '../page.js';
import { readBackup, restoreBackup } from '../backup.js';
import { state } from '../db.js';
import Busboy from 'busboy';

export const router = Router();
const BOOT = Date.now();
const anon = { csrf: '' };
const hasUsers = async () => (await pool.query('select 1 from users limit 1')).rows.length > 0;
const secretOk = (given) => { const s = process.env.SETUP_SECRET || ''; return s.length >= 12 && given === s; };

router.get('/setup', async (req, res) => {
  if (await hasUsers()) return res.redirect('/login');
  const missing = !(process.env.SETUP_SECRET || '').trim() || process.env.SETUP_SECRET.length < 12;
  const body = h`<h1>Set up ${req.app.locals.custom.labels.appName}</h1>
  ${missing ? h`<div class="flash warn"><b>SETUP_SECRET is not set</b> (or is shorter than 12 characters). In the Back4app dashboard open <i>Settings → Environment variables</i>, add <code>SETUP_SECRET</code> with a passphrase of five unrelated words, save, deploy, then reload this page.</div>` : ''}
  <div class="cols"><section class="card"><h2>Create the owner account</h2>
  ${form('/setup', anon, once(), h`${field('Setup passphrase (from the dashboard)', input('secret', '', 'type="password" required autocomplete="off"'))}
  ${field('Your name', input('name', '', 'required'))}${field('E-mail', input('email', '', 'type="email" required'))}
  ${field('Password (12+ characters)', input('password', '', 'type="password" required minlength="12"'))}${button('Create owner account')}`)}</section>
  <section class="card"><h2>…or restore a backup</h2><p>Have a <code>.firmbook-backup.zip</code> from another deployment? Restore it here; you will sign in with the passwords from that backup.</p>
  ${form('/setup/restore', anon, once(), h`${field('Setup passphrase (from the dashboard)', input('secret', '', 'type="password" required autocomplete="off"'))}
  ${field('Backup file', raw('<input type="file" name="file" accept=".zip" required>'))}${button('Restore backup', 'btn ghost')}`, 'enctype="multipart/form-data"')}</section></div>
  <p class="muted">An unpublished URL is not a secret — new hostnames appear in public certificate logs within minutes. The passphrase is what proves this deployment is yours. Save your recovery codes on the next screen.</p>`;
  page(req, res, { title: 'Setup', body, noindex: true });
});

router.post('/setup', async (req, res) => {
  if (await hasUsers()) return page(req, res, { title: 'Setup', status: 409, body: h`<h1>Already set up</h1><p><a href="/login">Log in</a>.</p>` });
  if (!secretOk(req.body.secret || '')) return page(req, res, { title: 'Setup', status: 403, body: h`<h1>Wrong passphrase</h1><p>The setup passphrase does not match <code>SETUP_SECRET</code> in the dashboard. <a href="/setup">Try again</a>.</p>` });
  const { name, email, password } = req.body;
  if (!name?.trim() || !/^[^@\s]+@[^@\s]+$/.test(email || '') || (password || '').length < 12) return page(req, res, { title: 'Setup', status: 400, body: h`<h1>Check the form</h1><p>Name, a valid e-mail and a password of 12+ characters are required. <a href="/setup">Back</a>.</p>` });
  let codes, userId;
  try {
    await tx(async (c) => {
      await c.query('insert into bootstrap (id) values (1)');          // unique: a second concurrent setup fails here
      userId = (await c.query('insert into users (email, name, password_hash, role) values ($1,$2,$3,$4) returning id', [email.trim().toLowerCase(), name.trim(), await hashPassword(password), 'owner'])).rows[0].id;
      codes = await makeRecoveryCodes(c, userId);
      await audit(c, { id: userId, name }, 'setup', 'user', userId);
      const sid = await createSession(c, userId); setSessionCookie(req, res, sid);
    });
  } catch (e) {
    if (e.code === '23505') return page(req, res, { title: 'Setup', status: 409, body: h`<h1>Already set up</h1><p>An owner account already exists for this deployment. <a href="/login">Log in</a>.</p>` });
    throw e;
  }
  page(req, res, { title: 'Recovery codes', body: h`<h1>Save these recovery codes</h1><p>Each code resets your password once if you lose it. Store them somewhere safe — they are shown only now.</p>
    <pre class="codes">${codes.join('\n')}</pre><p><a class="btn" href="/settings">Continue to Settings</a></p>` });
});

router.post('/setup/restore', async (req, res) => {
  if (await hasUsers()) return res.status(409).send('already set up');
  const { fields, file } = await readMultipart(req);
  if (!secretOk(fields.secret || '')) return page(req, res, { title: 'Setup', status: 403, body: h`<h1>Wrong passphrase</h1><p><a href="/setup">Try again</a>.</p>` });
  if (!file) return page(req, res, { title: 'Setup', status: 400, body: h`<h1>No file</h1><p><a href="/setup">Back</a>.</p>` });
  const parsed = readBackup(file);
  const rows = await tx(async (c) => {
    await c.query('insert into bootstrap (id) values (1)');
    return restoreBackup(c, parsed, { schemaVersion: state.schemaVersion, user: null, firstRun: true });
  });
  page(req, res, { title: 'Restored', body: h`<h1>Backup restored</h1><p>${rows} rows from ${parsed.manifest.created_at}. Sign in with the e-mail and password you used in that deployment.</p><p><a class="btn" href="/login">Log in</a></p>` });
});

export function readMultipart(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1 } });
    const fields = {}; let file = null;
    bb.on('field', (k, v) => { fields[k] = v; });
    bb.on('file', (name, stream) => { const chunks = []; stream.on('data', (d) => chunks.push(d)); stream.on('limit', () => reject(Object.assign(new Error('File too large.'), { status: 413 }))); stream.on('end', () => { file = Buffer.concat(chunks); }); });
    bb.on('error', reject); bb.on('close', () => resolve({ fields, file }));
    req.pipe(bb);
  });
}

router.get('/login', async (req, res) => {
  if (!(await hasUsers())) return res.redirect('/setup');
  if (req.user) return res.redirect('/');
  const demo = (await pool.query(`select email from users where role = 'demo' limit 1`)).rows[0];
  page(req, res, { title: 'Log in', body: h`<h1>Log in</h1>${form('/login', anon, null, h`${field('E-mail', input('email', req.query.email || '', 'type="email" required autofocus'))}
    ${field('Password', input('password', '', 'type="password" required'))}${button('Log in')}`)}
    <p class="muted"><a href="/recover">Lost your password? Use a recovery code</a> · <a href="/lost-access">Lost everything?</a></p>
    ${demo ? h`<p class="muted">Demo: sign in as <code>${demo.email}</code> (read-only).</p>` : ''}` });
});
router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!loginAllowed(email)) return page(req, res, { title: 'Log in', status: 429, body: h`<h1>Too many attempts</h1><p>Wait 15 minutes and try again.</p>` });
  const u = (await pool.query('select * from users where email = $1', [email])).rows[0];
  if (!u || !(await verifyPassword(req.body.password || '', u.password_hash))) { loginFailed(email); return page(req, res, { title: 'Log in', status: 401, body: h`<h1>Wrong e-mail or password</h1><p><a href="/login?email=${email}">Try again</a></p>` }); }
  const sid = await tx((c) => createSession(c, u.id)); setSessionCookie(req, res, sid);
  res.redirect('/');
});
router.post('/logout', async (req, res) => {
  if (req.user) await pool.query('delete from sessions where id = $1', [req.user.sessionId]);   // the row is the session; the cookie is just its name
  res.clearCookie(COOKIE, { path: '/' }); res.redirect('/login');
});

router.get('/recover', (req, res) => page(req, res, { title: 'Recovery code', body: h`<h1>Reset with a recovery code</h1>
  ${form('/recover', anon, once(), h`${field('E-mail', input('email', '', 'type="email" required'))}${field('Recovery code', input('code', '', 'required placeholder="a1b2c3-d4e5f6"'))}
  ${field('New password (12+ characters)', input('password', '', 'type="password" required minlength="12"'))}${button('Reset password')}`)}` }));
router.post('/recover', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!loginAllowed(email)) return page(req, res, { title: 'Recovery', status: 429, body: h`<h1>Too many attempts</h1>` });
  if ((req.body.password || '').length < 12) return page(req, res, { title: 'Recovery', status: 400, body: h`<h1>Password too short</h1><p><a href="/recover">Back</a></p>` });
  const ok = await tx(async (c) => {
    const userId = await useRecoveryCode(c, email, req.body.code || '');
    if (!userId) return false;
    await c.query('update users set password_hash = $2 where id = $1', [userId, await hashPassword(req.body.password)]);
    await revokeAllSessions(c, userId);
    await audit(c, { id: userId, name: email }, 'password-reset-recovery-code', 'user', userId);
    return true;
  });
  if (!ok) { loginFailed(email); return page(req, res, { title: 'Recovery', status: 401, body: h`<h1>That code did not work</h1><p>Check the e-mail and the code (each code works once). <a href="/recover">Try again</a></p>` }); }
  page(req, res, { title: 'Password reset', body: h`<h1>Password reset</h1><p>All other sessions were signed out. <a class="btn" href="/login">Log in</a></p>` });
});

/** Lost everything: the page shows a fresh random code; only a code that arrives through the dashboard variable is accepted. */
router.get('/lost-access', (req, res) => {
  const code = newToken(18);
  page(req, res, { title: 'Lost access', body: h`<h1>Lost access to the owner account?</h1>
  <ol><li>Copy this code: <code class="big">${code}</code></li>
  <li>In the Back4app dashboard open <i>Settings → Environment variables</i>, add <code>OWNER_RESET_TOKEN</code> with that code, save and <b>Deploy now</b>.</li>
  <li>Within 30 minutes of that deploy, come back here and enter the same code with a new password.</li></ol>
  <p class="muted">Knowing the owner's e-mail is not enough: the code has to reach the app through the dashboard, which only the account owner can open. The code works once.</p>
  ${form('/lost-access', anon, once(), h`${field('Code', input('code', '', 'required autocomplete="off"'))}${field('Owner e-mail', input('email', '', 'type="email" required'))}
  ${field('New password (12+ characters)', input('password', '', 'type="password" required minlength="12"'))}${button('Reset owner password')}`)}` });
});
router.post('/lost-access', async (req, res) => {
  const env = process.env.OWNER_RESET_TOKEN || '', given = String(req.body.code || '').trim(), email = String(req.body.email || '').trim().toLowerCase();
  const fresh = Date.now() - BOOT < 30 * 60e3;
  const fail = (why) => page(req, res, { title: 'Lost access', status: 403, body: h`<h1>Not accepted</h1><p>${why}</p><p><a href="/lost-access">Back</a></p>` });
  if (!loginAllowed(email)) return fail('Too many attempts. Wait 15 minutes.');
  if (!env || env.length < 16 || given !== env) { loginFailed(email); return fail('The code does not match OWNER_RESET_TOKEN in the dashboard, or the variable is not set.'); }
  if (!fresh) return fail('More than 30 minutes have passed since the deploy that introduced this code. Deploy again and retry within 30 minutes.');
  if ((req.body.password || '').length < 12) return fail('Password too short.');
  const done = await tx(async (c) => {
    const s = await getSettings(c);
    if (s.reset_token_used === sha256(env)) return 'used';
    const u = (await c.query(`select id from users where email = $1 and role = 'owner'`, [email])).rows[0];
    if (!u) return 'no-owner';
    await c.query('update users set password_hash = $2 where id = $1', [u.id, await hashPassword(req.body.password)]);
    await revokeAllSessions(c, u.id);
    await setSetting(c, 'reset_token_used', sha256(env)); await setSetting(c, 'reset_token_used_at', new Date().toISOString());
    await audit(c, { id: u.id, name: email }, 'password-reset-dashboard-token', 'user', u.id);
    return 'ok';
  });
  if (done === 'used') return fail('This code was already used. Generate a new one.');
  if (done === 'no-owner') { loginFailed(email); return fail('No owner account with that e-mail.'); }
  page(req, res, { title: 'Password reset', body: h`<h1>Owner password reset</h1><p>You can remove <code>OWNER_RESET_TOKEN</code> from the dashboard now (it cannot be reused anyway). <a class="btn" href="/login">Log in</a></p>` });
});
