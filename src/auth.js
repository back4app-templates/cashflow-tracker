// Passwords (scrypt from Node's crypto — no native build in the buildpack), server-side sessions, CSRF, one-time form keys.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { pool, tx } from './db.js';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export const INACTIVITY_DAYS = 14, ABSOLUTE_DAYS = 90, COOKIE = 'fb_session';

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(pw, stored) {
  try {
    const [, N, r, p, salt, hash] = String(stored).split('$');
    const key = await scrypt(String(pw), Buffer.from(salt, 'base64url'), SCRYPT.keylen, { N: +N, r: +r, p: +p });
    const h = Buffer.from(hash, 'base64url');
    return key.length === h.length && timingSafeEqual(key, h);
  } catch { return false; }
}

const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || req.secure;
export function setSessionCookie(req, res, id) {
  res.cookie(COOKIE, id, { httpOnly: true, sameSite: 'lax', secure: secure(req), path: '/', maxAge: ABSOLUTE_DAYS * 86400 * 1000 });
}
export async function createSession(c, userId) {
  const id = newToken(32), csrf = newToken(16);
  await c.query('insert into sessions (id, user_id, csrf) values ($1, $2, $3)', [id, userId, csrf]);
  return id;
}
export const revokeAllSessions = (c, userId, exceptId = null) =>
  c.query('delete from sessions where user_id = $1 and ($2::text is null or id <> $2)', [userId, exceptId]);

/** Loads the session row and user for every request; expiry is decided here, on the server, never by the cookie. */
export async function sessionMiddleware(req, res, next) {
  req.user = null; req.flash = null;
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter(([k]) => k));
  const id = cookies[COOKIE];
  if (!id) return next();
  const r = await pool.query(`select s.id, s.csrf, s.flash, s.created_at, s.last_seen_at, u.id as user_id, u.email, u.name, u.role
    from sessions s join users u on u.id = s.user_id where s.id = $1`, [id]);
  const s = r.rows[0];
  const now = Date.now();
  if (!s || now - new Date(s.last_seen_at).getTime() > INACTIVITY_DAYS * 86400e3 || now - new Date(s.created_at).getTime() > ABSOLUTE_DAYS * 86400e3) {
    if (s) await pool.query('delete from sessions where id = $1', [id]);
    res.clearCookie(COOKIE, { path: '/' });
    return next();
  }
  req.user = { id: s.user_id, email: s.email, name: s.name, role: s.role, csrf: s.csrf, sessionId: s.id };
  req.flash = s.flash || null;
  const touch = now - new Date(s.last_seen_at).getTime() > 60e3;
  await pool.query(`update sessions set last_seen_at = case when $2 then now() else last_seen_at end, flash = null where id = $1`, [id, touch]);
  next();
}

export async function setFlash(req, kind, text) {
  if (req.user) await pool.query('update sessions set flash = $2 where id = $1', [req.user.sessionId, JSON.stringify({ kind, text })]);
}

export const requireUser = (req, res, next) => req.user ? next() : res.redirect('/login');
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.redirect('/login');
  if (!roles.includes(req.user.role)) return res.status(403).send(req.app.locals.pages.forbidden(req));
  next();
};
/** Every POST from a signed-in user must carry the session's CSRF token; the demo role may never write. */
export function csrfCheck(req, res, next) {
  if (req.method !== 'POST') return next();
  if (!req.user) return next();
  if (/^multipart\/form-data/i.test(req.headers['content-type'] || '')) return next();   // the route reads the fields itself and checks _csrf there
  if (req.body?._csrf !== req.user.csrf) return res.status(403).send(req.app.locals.pages.forbidden(req, 'This form expired. Go back and try again.'));
  if (req.user.role === 'demo' && !['/logout'].includes(req.path)) return res.status(403).send(req.app.locals.pages.forbidden(req, 'The demo account is read-only.'));
  next();
}
/** Idempotency: the form carried `_once`; the first write consumes it, a retry finds it consumed. Returns false on a replay. */
export async function consumeOnce(c, req) {
  const key = req.body?._once;
  if (!key || key.length < 16) throw Object.assign(new Error('missing form key'), { status: 400 });
  try { await c.query('insert into idempotency_keys (key) values ($1)', [`${req.user?.id ?? 'anon'}:${key}`]); return true; }
  catch (e) { if (e.code === '23505') return false; throw e; }
}
export const once = () => newToken(16);

/** Login throttle: 10 attempts per e-mail per 15 minutes, in memory (one process). */
const attempts = new Map();
export function loginAllowed(email) {
  const now = Date.now(), a = (attempts.get(email) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(email, a);
  return a.length < 10;
}
export const loginFailed = (email) => attempts.set(email, [...(attempts.get(email) || []), Date.now()]);

export async function makeRecoveryCodes(c, userId) {
  await c.query('delete from recovery_codes where user_id = $1', [userId]);
  const codes = Array.from({ length: 8 }, () => `${randomBytes(3).toString('hex')}-${randomBytes(3).toString('hex')}`);
  for (const code of codes) await c.query('insert into recovery_codes (user_id, code_hash) values ($1, $2)', [userId, sha256(code)]);
  return codes;
}
export async function useRecoveryCode(c, email, code) {
  const r = await c.query(`select rc.id, u.id as user_id from recovery_codes rc join users u on u.id = rc.user_id
    where lower(u.email) = lower($1) and rc.code_hash = $2 and rc.used_at is null for update`, [email, sha256(String(code).trim().toLowerCase())]);
  if (!r.rows[0]) return null;
  await c.query('update recovery_codes set used_at = now() where id = $1', [r.rows[0].id]);
  return r.rows[0].user_id;
}
